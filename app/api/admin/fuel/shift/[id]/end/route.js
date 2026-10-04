import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { summarizePumpCollection } from '@/lib/fuelCollections.mjs';
import { createShiftTankReconciliations } from '@/lib/fuelTankReconciliation';

const CASH_TOLERANCE_PCT = 0.01; // flat 1% for v1 — per-product tolerance is a later refinement

// Cash-up (core-algorithms skill §6): expectedCash = openingFloat + cash sales. A difference
// outside tolerance requires a note but never blocks closing — it raises a Flag instead.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'shifts.run')) {
    return NextResponse.json({ error: 'You do not have permission to run a shift' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const countedCash = Math.round(Number(body.countedCash));
    const countedFloat = body.countedFloat != null && body.countedFloat !== '' ? Math.round(Number(body.countedFloat)) : null;
    const note = (body.note || '').trim();
    if (!Number.isFinite(countedCash)) throw new ApiError('Counted cash is required', 400);

    const shift = await prisma.shift.findUnique({ where: { id } });
    if (!shift) throw new ApiError('Shift not found', 404);
    if (shift.status !== 'open') throw new ApiError('Shift is not open', 400);
    const access = await getAccessibleBranchIds(session);
    if (!canAccessBranch(access, shift.branchId)) throw new ApiError('Access denied to this branch', 403);

    const readings = await prisma.meterReading.findMany({ where: { shiftId: id }, include: { dispenser: { include: { tank: true } } } });
    if (readings.length === 0) throw new ApiError('No dispenser has been closed for this shift yet', 400);
    const incomplete = readings.filter((r) => r.closing == null || r.reviewStatus !== 'approved');
    if (incomplete.length) throw new ApiError(`Submit and approve every pump before ending this shift: ${incomplete.map((r) => r.dispenser.label).join(', ')}`, 400);
    const [tanks, closingDips, openingDips, branch] = await Promise.all([
      prisma.tank.findMany({ where: { branchId: shift.branchId, isActive: true } }),
      prisma.fuelTankDip.findMany({ where: { shiftId: id, period: 'closing' } }),
      prisma.fuelTankDip.findMany({ where: { shiftId: id, period: 'opening' } }),
      prisma.branch.findUnique({ where: { id: shift.branchId } }),
    ]);
    const undipped = tanks.filter((tank) => !closingDips.some((dip) => dip.tankId === tank.id));
    if (undipped.length) throw new ApiError(`Closing stock missing for: ${undipped.map((tank) => tank.label).join(', ')}`, 400);
    const collections = await prisma.fuelCollection.findMany({ where: { shiftId: id } });
    const missing = readings.filter((r) => r.litres > 0 && !collections.some((c) => c.dispenserId === r.dispenserId && !c.voidedAt && c.collectionType === 'initial' && c.totalAmount > 0));
    if (missing.length) throw new ApiError(`Initial collection missing for: ${missing.map((r) => r.dispenser.label).join(', ')}`, 400);
    const perPump = readings.map((r) => ({ reading: r, totals: summarizePumpCollection(r.expectedAmount, collections.filter((c) => c.dispenserId === r.dispenserId)) }));
    const outstanding = perPump.reduce((sum, p) => sum + p.totals.outstanding, 0);
    const hasPlannedNextShift = !!(shift.shiftOrder && shift.totalShiftsPlanned && shift.shiftOrder < shift.totalShiftsPlanned);
    const continueToNextShift = hasPlannedNextShift && body.continueToNextShift === true;
    const nextAssignments = Array.isArray(body.attendantAssignments) ? body.attendantAssignments : [];
    if (continueToNextShift) {
      const pumpIds = new Set(readings.map((reading) => reading.dispenserId));
      const attendantIds = new Set(nextAssignments.map((entry) => entry.attendantId));
      if (nextAssignments.length !== pumpIds.size || new Set(nextAssignments.map((entry) => entry.dispenserId)).size !== pumpIds.size ||
          nextAssignments.some((entry) => !pumpIds.has(entry.dispenserId) || !entry.attendantId)) {
        throw new ApiError('Choose an attendant for every pump in the next shift', 400);
      }
      const attendants = await prisma.attendant.findMany({ where: { branchId: shift.branchId, id: { in: [...attendantIds] }, isActive: true }, select: { id: true } });
      if (attendants.length !== attendantIds.size) throw new ApiError('Every next-shift attendant must be active at this branch', 400);
    }

    const orders = await prisma.order.findMany({ where: { id: { in: readings.map((r) => r.orderId).filter(Boolean) } } });
    const salesTotal = orders.reduce((sum, o) => sum + o.grandTotal, 0);
    const expectedCash = shift.openingFloat + perPump.reduce((sum, p) => sum + p.totals.cash, 0);
    const difference = countedCash - expectedCash;

    const tolerance = Math.round(Math.abs(expectedCash) * CASH_TOLERANCE_PCT);
    const outsideTolerance = Math.abs(difference) > tolerance;
    if (outsideTolerance && !note) {
      throw new ApiError(`Difference of ${difference} is outside the 1% tolerance — a note is required to close`, 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const periodEnd = new Date();
      await createShiftTankReconciliations(tx, { shift, readings, tanks, openingDips, closingDips, branch, actorId: session.user.id, periodEnd });
      const changed = await tx.shift.updateMany({ where: { id, status: 'open' },
        data: { countedCash, countedFloat, expectedCash, difference, status: 'closed', closedAt: periodEnd, note: note || null,
          ...(hasPlannedNextShift && !continueToNextShift ? { totalShiftsPlanned: shift.shiftOrder } : {}) },
      });
      if (changed.count !== 1) throw new ApiError('This shift has already closed', 409);
      const closedShift = await tx.shift.findUnique({ where: { id } });

      let nextShift = null;
      if (continueToNextShift) {
        const nextOrder = shift.shiftOrder + 1;
        nextShift = await tx.shift.create({ data: {
          branchId: shift.branchId, openedBy: session.user.id, openingFloat: countedFloat ?? shift.openingFloat,
          operatingDate: shift.operatingDate, shiftOrder: nextOrder, totalShiftsPlanned: shift.totalShiftsPlanned,
          shiftLabel: `Shift ${nextOrder}`, openedAt: periodEnd,
        } });
        await tx.fuelTankDip.createMany({ data: closingDips.map((dip) => ({
          branchId: shift.branchId, shiftId: nextShift.id, tankId: dip.tankId,
          operatingDate: shift.operatingDate, period: 'opening', measured: dip.measured, recordedBy: session.user.id,
        })) });
        for (const reading of readings) {
          const attendantId = nextAssignments.find((entry) => entry.dispenserId === reading.dispenserId).attendantId;
          await tx.attendantAssignment.create({ data: { branchId: shift.branchId, shiftId: nextShift.id,
            dispenserId: reading.dispenserId, attendantId, assignedBy: session.user.id } });
          await tx.meterReading.create({ data: { branchId: shift.branchId, shiftId: nextShift.id,
            dispenserId: reading.dispenserId, opening: reading.closing, recordedBy: session.user.id } });
        }
      }

      if (outsideTolerance) {
        await tx.flag.create({
          data: {
            branchId: shift.branchId, targetType: 'Shift', targetId: id, severity: 'concern', classification: 'concern',
            reason: `Cash-up difference of ${difference} outside 1% tolerance. Note: ${note}`, raisedBy: session.user.id,
          },
        });
      }

      return { shift: closedShift, nextShift };
    }, { timeout: 30000 }); // closing all tank products can take several Neon round trips

    return NextResponse.json({ success: true, data: { ...result, salesTotal, outstanding, flagged: outsideTolerance } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
