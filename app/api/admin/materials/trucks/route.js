import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Ported from ecana_shop-app's /api/trucks — a truck is a Vehicle (already shared with fuel's
// deliveries), filtered/typed for materials use. "Busy" is computed from open (non-closed)
// allocation Deliveries referencing it, same as the old app's busyReason.
export const GET = withOrg(async () => {
  const trucks = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { plateNumber: 'asc' } });
  const truckIds = trucks.map((t) => t.id);

  const busyDeliveries = await prisma.delivery.findMany({
    where: { vehicleId: { in: truckIds }, qtyRemaining: { not: null }, status: { not: 'closed' } },
    include: { product: true },
  });

  const data = trucks.map((t) => {
    const d = busyDeliveries.find((d) => d.vehicleId === t.id);
    const busyReason = d ? `On ATC ${d.atcNumber || d.id.slice(-6)} (${d.qtyRemaining} ${d.product.unit}${d.qtyRemaining === 1 ? '' : 's'} remaining)` : null;
    return { ...t, busy: !!busyReason, busyReason };
  });

  return NextResponse.json({ success: true, data });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'materials.catalog.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage trucks' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const plateNumber = (body.plateNumber || '').trim().toUpperCase();
    const driverName = (body.driverName || '').trim();
    const type = body.type; // cement | aggregate
    if (!plateNumber || !driverName) throw new ApiError('Plate number and driver name are required', 400);
    if (!['cement', 'aggregate'].includes(type)) throw new ApiError('Truck type is required', 400);

    const existing = await prisma.vehicle.findFirst({ where: { plateNumber } });
    if (existing) throw new ApiError('Plate number already exists', 400);

    const truck = await prisma.vehicle.create({
      data: {
        plateNumber, driverName, driverPhone: (body.driverPhone || '').trim() || null, type,
        capacity: body.capacity ? Number(body.capacity) : null,
        ownership: body.ownership || 'own',
      },
    });
    return NextResponse.json({ success: true, data: truck }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
