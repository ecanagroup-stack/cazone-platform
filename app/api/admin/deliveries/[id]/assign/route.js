import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { optionalBusinessDate, backdatedAt, assertNotBefore } from '@/lib/saleDates.mjs';
import { effectiveDate } from '@/lib/businessDates.mjs';
import { requireBackdateOtp, assertBackdateOtpPresent, notifyBackdated } from '@/lib/backdating';
import { jsonSafe } from '@/lib/jsonSafe';

// Assign a vehicle to go collect a pending allocation — pending -> assigned. Mirrors the old shop
// app's ATC "assign" step: creates the Vehicle by plate if it doesn't exist yet. `date` records a
// past assignment (needs the back-dating code); blank means now.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'allocations.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage allocations' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const vehiclePlate = (body.vehiclePlate || '').trim();
    if (!vehiclePlate) throw new ApiError('A vehicle plate number is required', 400);

    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery || !canAccessBranch(await getAccessibleBranchIds(session), delivery.branchId)) throw new ApiError('Not found', 404);
    if (delivery.qtyRemaining == null) throw new ApiError('This delivery is not an allocation', 400);
    if (delivery.status !== 'pending') throw new ApiError(`Cannot assign a delivery that is already ${delivery.status}`, 400);

    const date = optionalBusinessDate(body.date, 'Assigned date');
    assertNotBefore(date, date && effectiveDate(delivery, 'businessDate'), 'Assigned date');
    assertBackdateOtpPresent(date, body.backdateOtp);
    const backdated = await requireBackdateOtp({ userId: session.user.id, date, otp: body.backdateOtp });

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findFirst({ where: { plateNumber: vehiclePlate } });
      const vehicleId = existing ? existing.id : (await tx.vehicle.create({ data: { plateNumber: vehiclePlate, driverName: body.driverName || null, driverPhone: body.driverPhone || null } })).id;
      return tx.delivery.update({
        where: { id }, data: { vehicleId, status: 'assigned', assignedAt: backdatedAt(date) || new Date() },
        include: { supplier: true, vehicle: true, product: true },
      });
    });

    if (backdated) await notifyBackdated({
      actor: session.user, branchId: delivery.branchId, date, relatedType: 'Delivery', relatedId: id,
      what: `the assignment of ${updated.atcNumber ? `ATC ${updated.product.abbreviation}-${updated.atcNumber}` : `${updated.product.name} allocation`} to ${updated.vehicle.plateNumber}`,
    });

    return NextResponse.json(jsonSafe({ success: true, data: updated }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
