import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Assign a vehicle to go collect a pending allocation — pending -> assigned. Mirrors the old shop
// app's ATC "assign" step: creates the Vehicle by plate if it doesn't exist yet.
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
    if (!delivery) throw new ApiError('Not found', 404);
    if (delivery.qtyRemaining == null) throw new ApiError('This delivery is not an allocation', 400);
    if (delivery.status !== 'pending') throw new ApiError(`Cannot assign a delivery that is already ${delivery.status}`, 400);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findFirst({ where: { plateNumber: vehiclePlate } });
      const vehicleId = existing ? existing.id : (await tx.vehicle.create({ data: { plateNumber: vehiclePlate, driverName: body.driverName || null, driverPhone: body.driverPhone || null } })).id;
      return tx.delivery.update({
        where: { id }, data: { vehicleId, status: 'assigned', assignedAt: new Date() },
        include: { supplier: true, vehicle: true, product: true },
      });
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
