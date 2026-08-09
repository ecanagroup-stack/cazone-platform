import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
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
      for (const p of prices) {
        const newPrice = Math.round(Number(p.price));
        if (!Number.isFinite(newPrice) || newPrice <= 0) continue;
        const current = await tx.priceRule.findFirst({ where: { productId: p.productId, validTo: null }, orderBy: { validFrom: 'desc' } });
        if (!current || current.price !== newPrice) {
          if (current) await tx.priceRule.update({ where: { id: current.id }, data: { validTo: new Date() } });
          await tx.priceRule.create({ data: { productId: p.productId, price: newPrice, createdBy: session.user.id } });
        }
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

      return createdShift;
    });

    return NextResponse.json({ success: true, data: shift }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
