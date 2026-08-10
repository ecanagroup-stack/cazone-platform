import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

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

    const readings = await prisma.meterReading.findMany({ where: { shiftId: id, orderId: { not: null } } });
    if (readings.length === 0) throw new ApiError('No dispenser has been closed for this shift yet', 400);

    const orders = await prisma.order.findMany({ where: { id: { in: readings.map((r) => r.orderId) } } });
    const salesTotal = orders.reduce((sum, o) => sum + o.grandTotal, 0);
    const expectedCash = shift.openingFloat + salesTotal;
    const difference = countedCash - expectedCash;

    const tolerance = Math.round(Math.abs(expectedCash) * CASH_TOLERANCE_PCT);
    const outsideTolerance = Math.abs(difference) > tolerance;
    if (outsideTolerance && !note) {
      throw new ApiError(`Difference of ${difference} is outside the 1% tolerance — a note is required to close`, 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const closedShift = await tx.shift.update({
        where: { id },
        data: { countedCash, countedFloat, expectedCash, difference, status: 'closed', closedAt: new Date(), note: note || null },
      });

      if (outsideTolerance) {
        await tx.flag.create({
          data: {
            branchId: shift.branchId, targetType: 'Shift', targetId: id, severity: 'concern', classification: 'concern',
            reason: `Cash-up difference of ${difference} outside 1% tolerance. Note: ${note}`, raisedBy: session.user.id,
          },
        });
      }

      return closedShift;
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    return NextResponse.json({ success: true, data: { shift: updated, salesTotal, flagged: outsideTolerance } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
