import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { requireRecordBranch } from '@/lib/branchAccess';
import { summarizePumpCollection } from '@/lib/fuelCollections.mjs';
import { logAudit } from '@/lib/audit';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Owner correction while a shift is open. The handover remains in the audit trail;
// the cashier enters its replacement as a new collection.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'owner') return NextResponse.json({ error: 'Only the Admin can correct a collection' }, { status: 403 });
  try {
    const { id } = await params;
    const { reason } = await request.json();
    if (!reason?.trim()) throw new ApiError('A correction reason is required', 400);
    const collection = await prisma.fuelCollection.findUnique({ where: { id } });
    await requireRecordBranch(session, collection, 'Collection not found');
    if (collection.voidedAt) throw new ApiError('Collection has already been corrected', 409);
    const shift = await prisma.shift.findUnique({ where: { id: collection.shiftId } });
    if (shift?.status !== 'open') throw new ApiError('Only open-shift collections can be corrected', 409);

    await prisma.$transaction(async (tx) => {
      const currentShift = await tx.shift.findUnique({ where: { id: collection.shiftId } });
      if (currentShift?.status !== 'open') throw new ApiError('The shift closed before this correction was saved', 409);
      await tx.fuelCollection.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: session.user.id, voidReason: reason.trim() } });
      const active = await tx.fuelCollection.findMany({ where: { meterReadingId: collection.meterReadingId, voidedAt: null }, orderBy: { createdAt: 'asc' } });
      const totals = summarizePumpCollection(collection.expectedAmount, active);
      await tx.posPayment.deleteMany({ where: { meterReadingId: collection.meterReadingId } });
      const posEntries = active.flatMap((row) => Array.isArray(row.posEntries) ? row.posEntries : []);
      if (posEntries.length) await tx.posPayment.createMany({ data: posEntries.map((p) => ({
        meterReadingId: collection.meterReadingId, terminalId: p.terminalId, amount: p.amount,
      })) });
      const reading = await tx.meterReading.update({ where: { id: collection.meterReadingId }, data: {
        cashCollected: active.length ? totals.cash : null,
        paymentRecordedAt: active.length ? active[active.length - 1].createdAt : null,
        paymentRecordedBy: active.length ? active[active.length - 1].recordedBy : null,
      } });
      if (reading.orderId) await tx.order.update({ where: { id: reading.orderId }, data: {
        paymentMethod: totals.cash > 0 && totals.pos > 0 ? 'mixed' : totals.pos > 0 ? 'pos' : 'cash',
      } });
    }, { isolationLevel: 'Serializable', timeout: 15000 });
    await logAudit({ organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'fuel.collection.voided', entityType: 'FuelCollection', entityId: id,
      before: { cashAmount: collection.cashAmount, posAmount: collection.posAmount }, after: { reason: reason.trim() } });
    await notifyAlteration({
      actor: session.user, branchId: collection.branchId, type: 'collection_voided', title: 'Fuel collection corrected',
      message: `${session.user.name} voided a pump collection. Reason: ${reason.trim()}`, relatedType: 'FuelCollection', relatedId: id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
}, 'fuel_station');
