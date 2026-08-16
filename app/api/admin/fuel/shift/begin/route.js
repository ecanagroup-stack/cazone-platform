import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setPrice } from '@/lib/pricing';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Transaction: applies any price changes (closing the old effective-dated PriceRule, opening a new
// one — core-algorithms skill §1, "changing a price never mutates a row"), creates the Shift, and
// for each assigned dispenser creates its AttendantAssignment + opening MeterReading.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'shifts.run')) {
    return NextResponse.json({ error: 'You do not have permission to run a shift' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const openingFloat = Math.round(Number(body.openingFloat) || 0);
    const assignments = Array.isArray(body.assignments) ? body.assignments : []; // [{dispenserId, attendantId, opening}]
    const prices = Array.isArray(body.prices) ? body.prices : []; // [{productId, price}]

    if (!branchId) throw new ApiError('branchId is required', 400);
    if (assignments.length === 0) throw new ApiError('Assign at least one dispenser to open a shift', 400);
    for (const a of assignments) {
      if (!a.dispenserId || !a.attendantId || !Number.isFinite(Number(a.opening))) {
        throw new ApiError('Every assigned dispenser needs an attendant and an opening reading', 400);
      }
    }

    const existing = await prisma.shift.findFirst({ where: { branchId, status: 'open' } });
    if (existing) throw new ApiError('A shift is already open for this branch', 400);

    const shift = await prisma.$transaction(async (tx) => {
      let anyPricePending = false;
      for (const p of prices) {
        const newPrice = Math.round(Number(p.price));
        if (!Number.isFinite(newPrice) || newPrice <= 0) continue;
        const result = await setPrice(tx, p.productId, newPrice, { id: session.user.id, role: session.user.role });
        if (result.pending) anyPricePending = true;
      }

      const createdShift = await tx.shift.create({ data: { branchId, openedBy: session.user.id, openingFloat } });

      for (const a of assignments) {
        await tx.attendantAssignment.create({
          data: { branchId, dispenserId: a.dispenserId, shiftId: createdShift.id, attendantId: a.attendantId, assignedBy: session.user.id },
        });
        await tx.meterReading.create({
          data: { branchId, dispenserId: a.dispenserId, shiftId: createdShift.id, opening: Number(a.opening), recordedBy: session.user.id },
        });
      }

      return { shift: createdShift, anyPricePending };
    }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

    if (shift.anyPricePending) {
      await notify({ recipientRole: 'owner', type: 'price_proposed', title: 'Price change needs approval', message: 'A fuel price change from Begin Shift needs your approval', relatedType: 'Shift', relatedId: shift.shift.id });
    }

    return NextResponse.json({
      success: true, data: shift.shift,
      ...(shift.anyPricePending && { message: 'Shift started — one or more price changes need owner approval and are not yet in effect' }),
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
