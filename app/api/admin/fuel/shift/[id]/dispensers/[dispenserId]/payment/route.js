import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { summarizePumpCollection, validateCollectionInput, operatingDateAt } from '@/lib/fuelCollections.mjs';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!session?.user || !can(session.user.role, 'fuel.payments.record')) {
    return NextResponse.json({ error: 'You do not have permission to record fuel payments' }, { status: 403 });
  }
  try {
    const { id: shiftId, dispenserId } = await params;
    const body = await request.json();
    const posEntries = Array.isArray(body.posEntries)
      ? body.posEntries.map((p) => ({ terminalId: p.terminalId, amount: Number(p.amount) })) : [];
    const cashAmount = Number(body.cashCollected);
    let amounts;
    try { amounts = validateCollectionInput(cashAmount, posEntries); }
    catch (error) { throw new ApiError(error.message, 400); }
    const requestId = typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId.trim() : null;
    const note = typeof body.note === 'string' ? body.note.trim() : null;
    if (requestId && requestId.length > 100) throw new ApiError('Request ID is too long', 400);

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new ApiError('Shift not found', 404);
    const access = await getAccessibleBranchIds(session);
    if (!canAccessBranch(access, shift.branchId)) throw new ApiError('Access denied to this branch', 403);
    if (!['open', 'closed'].includes(shift.status)) throw new ApiError('The shift has not been opened', 409);

    const reading = await prisma.meterReading.findUnique({ where: { shiftId_dispenserId: { shiftId, dispenserId } } });
    if (!reading || reading.closing == null || !(reading.litres > 0) || !(reading.expectedAmount > 0)) {
      throw new ApiError('A supervisor must record positive litres sold on this pump first', 400);
    }
    if (reading.collectionCoverage === 'unknown') throw new ApiError('This legacy pump has no verified collection balance', 409);
    const terminalIds = [...new Set(posEntries.map((entry) => entry.terminalId))];
    if (terminalIds.length) {
      const terminals = await prisma.posTerminal.findMany({ where: { id: { in: terminalIds }, branchId: shift.branchId, isActive: true } });
      if (terminals.length !== terminalIds.length) throw new ApiError('Select active POS terminals from this branch', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentShift = await tx.shift.findUnique({ where: { id: shiftId } });
      const currentReading = await tx.meterReading.findUnique({ where: { id: reading.id } });
      if (!currentShift || !currentReading || currentReading.closing == null || !(currentReading.litres > 0)) {
        throw new ApiError('The shift or supervisor sale changed. Refresh and try again.', 409);
      }
      if (currentReading.collectionCoverage === 'unknown') throw new ApiError('This legacy pump has no verified collection balance', 409);
      if (requestId) {
        const previous = await tx.fuelCollection.findUnique({ where: { organizationId_requestId: { organizationId: session.user.organizationId, requestId } } });
        if (previous) {
          if (previous.shiftId !== shiftId || previous.dispenserId !== dispenserId || previous.cashAmount !== amounts.cashAmount ||
              JSON.stringify(previous.posEntries) !== JSON.stringify(posEntries)) {
            throw new ApiError('This collection request ID was already used for different payment details', 409);
          }
          return { collection: previous, replayed: true };
        }
      }
      const previous = await tx.fuelCollection.findMany({ where: { shiftId, dispenserId, voidedAt: null }, orderBy: { createdAt: 'asc' } });
      const before = summarizePumpCollection(currentReading.expectedAmount, previous);
      if (currentShift.status === 'closed') {
        if (!previous.some((row) => row.collectionType === 'initial') || before.outstanding <= 0) {
          throw new ApiError('Closed shifts only accept settlement of a previously collected short pump', 409);
        }
        if (amounts.totalAmount > before.outstanding) throw new ApiError('Collection exceeds this pump’s remaining balance', 400);
      }
      const assignment = await tx.attendantAssignment.findFirst({
        where: { shiftId, dispenserId }, orderBy: { assignedAt: 'desc' }, select: { attendantId: true },
      });
      const collection = await tx.fuelCollection.create({ data: {
        branchId: shift.branchId, shiftId, dispenserId, meterReadingId: reading.id,
        attendantId: assignment?.attendantId || null,
        operatingDate: currentShift.operatingDate || operatingDateAt(currentShift.openedAt),
        ...amounts, posEntries, expectedAmount: currentReading.expectedAmount,
        outstandingAfter: Math.max(0, before.outstanding - amounts.totalAmount),
        collectionType: currentShift.status === 'closed' ? 'post_close_settlement' : previous.some((row) => row.collectionType === 'initial') ? 'supplemental' : 'initial',
        recordedBy: session.user.id, requestId, note,
      } });
      await tx.meterReading.update({ where: { id: reading.id }, data: {
        cashCollected: { increment: amounts.cashAmount }, paymentRecordedBy: session.user.id, paymentRecordedAt: new Date(),
      } });
      if (posEntries.length) {
        await tx.posPayment.createMany({ data: posEntries.map((entry) => ({
          meterReadingId: reading.id, terminalId: entry.terminalId, amount: entry.amount,
        })) });
      }
      if (currentReading.orderId) {
        const after = summarizePumpCollection(currentReading.expectedAmount, [...previous, collection]);
        await tx.order.update({ where: { id: currentReading.orderId }, data: {
          paymentMethod: after.cash > 0 && after.pos > 0 ? 'mixed' : after.pos > 0 ? 'pos' : 'cash',
        } });
      }
      return { collection, replayed: false };
    }, { isolationLevel: 'Serializable', timeout: 15000 });

    if (!result.replayed) await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'fuel.collection.recorded', entityType: 'FuelCollection', entityId: result.collection.id,
      after: { shiftId, dispenserId, ...amounts, collectionType: result.collection.collectionType, outstandingAfter: result.collection.outstandingAfter },
    });
    return NextResponse.json({ success: true, data: result.collection, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const retryConflict = error.code === 'P2034' || error.code === 'P2002';
    return NextResponse.json({ error: retryConflict ? 'Another collection was saved at the same time. Refresh and try again.' : error.message },
      { status: retryConflict ? 409 : error.status || 400 });
  }
});
