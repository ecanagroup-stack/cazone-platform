import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!['owner', 'manager'].includes(session?.user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const truck = await prisma.vehicle.findFirst({ where: { id: params.id, OR: [{ type: 'tanker' }, { deliveries: { some: { branch: { service: { type: 'fuel_station' } } } } }] } });
    if (!truck) throw new ApiError('Fuel truck not found', 404);
    const body = await request.json();
    const reason = String(body.reason || '').trim();
    if (!reason) throw new ApiError('Give a reason for this change', 400);
    const data = {};
    if ('driverName' in body) { data.driverName = String(body.driverName || '').trim(); if (!data.driverName) throw new ApiError('Driver name is required', 400); }
    if ('driverPhone' in body) data.driverPhone = String(body.driverPhone || '').trim() || null;
    if ('capacity' in body) { data.capacity = body.capacity === '' || body.capacity == null ? null : Number(body.capacity); if (data.capacity != null && (!Number.isFinite(data.capacity) || data.capacity <= 0)) throw new ApiError('Capacity must be positive', 400); }
    if ('ownership' in body) { if (!['own', 'supplier'].includes(body.ownership)) throw new ApiError('Choose truck ownership', 400); data.ownership = body.ownership; }
    if ('isActive' in body) { if (typeof body.isActive !== 'boolean') throw new ApiError('Invalid status', 400); data.isActive = body.isActive; }
    if (Object.keys(data).length === 0) throw new ApiError('No changes submitted', 400);
    const updated = await prisma.vehicle.update({ where: { id: truck.id }, data });
    await logAudit({ organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name, action: 'fuel.truck.updated', entityType: 'Vehicle', entityId: truck.id, before: { plateNumber: truck.plateNumber, driverName: truck.driverName, driverPhone: truck.driverPhone, capacity: truck.capacity, ownership: truck.ownership, isActive: truck.isActive }, after: { ...data, reason } });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 400 }); }
});
