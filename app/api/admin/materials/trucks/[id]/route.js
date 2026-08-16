import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage trucks' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();

    const truck = await prisma.vehicle.findUnique({ where: { id } });
    if (!truck) throw new ApiError('Not found', 404);

    const busy = await prisma.delivery.findFirst({ where: { vehicleId: id, qtyRemaining: { not: null }, status: { not: 'closed' } } });
    if (busy && (body.plateNumber || body.type)) throw new ApiError('This truck is busy on an active ATC — it cannot be edited until that closes', 400);

    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.plateNumber === 'string' && body.plateNumber.trim()) update.plateNumber = body.plateNumber.trim().toUpperCase();
    if (typeof body.driverName === 'string' && body.driverName.trim()) update.driverName = body.driverName.trim();
    if (typeof body.driverPhone === 'string') update.driverPhone = body.driverPhone.trim() || null;
    if (body.type) update.type = body.type;
    if (body.capacityTonnes !== undefined) update.capacity = body.capacityTonnes ? Number(body.capacityTonnes) : null;
    if (body.ownership) update.ownership = body.ownership;

    const updated = await prisma.vehicle.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
