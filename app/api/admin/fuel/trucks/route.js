import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';

const fuelVehicles = { OR: [{ type: 'tanker' }, { deliveries: { some: { branch: { service: { type: 'fuel_station' } } } } }] };

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (!['owner', 'manager'].includes(session?.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [service, trucks] = await Promise.all([
    prisma.service.findFirst({ where: { type: 'fuel_station' }, select: { config: true } }),
    prisma.vehicle.findMany({ where: fuelVehicles, select: { id: true, plateNumber: true, driverName: true, driverPhone: true, ownership: true, capacity: true, isActive: true, deliveries: { where: { branch: { service: { type: 'fuel_station' } } }, select: { id: true, quantity: true, createdAt: true, branch: { select: { id: true, name: true } }, product: { select: { name: true, unit: true } } }, orderBy: { createdAt: 'desc' }, take: 5 } }, orderBy: { plateNumber: 'asc' } }),
  ]);
  return NextResponse.json({ success: true, data: trucks, historicalOnly: service?.config?.migrationStockPending === true });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!['owner', 'manager'].includes(session?.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await request.json();
    const plateNumber = String(body.plateNumber || '').trim().toUpperCase();
    const driverName = String(body.driverName || '').trim();
    const driverPhone = String(body.driverPhone || '').trim() || null;
    const capacity = body.capacity === '' || body.capacity == null ? null : Number(body.capacity);
    if (!plateNumber || !driverName) throw new ApiError('Plate number and driver name are required', 400);
    if (capacity != null && (!Number.isFinite(capacity) || capacity <= 0)) throw new ApiError('Capacity must be positive', 400);
    if (!['own', 'supplier'].includes(body.ownership)) throw new ApiError('Choose truck ownership', 400);
    if (await prisma.vehicle.findFirst({ where: { plateNumber } })) throw new ApiError('This plate number already exists', 409);
    const truck = await prisma.vehicle.create({ data: { plateNumber, driverName, driverPhone, capacity, ownership: body.ownership, type: 'tanker' } });
    await logAudit({ organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name, action: 'fuel.truck.created', entityType: 'Vehicle', entityId: truck.id, after: { plateNumber, driverName, driverPhone, capacity, ownership: body.ownership } });
    return NextResponse.json({ success: true, data: truck }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
});
