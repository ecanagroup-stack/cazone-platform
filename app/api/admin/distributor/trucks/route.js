import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { atcJson } from '@/lib/distributor';
import { OPEN_STATUSES } from '@/lib/petroleumAtc.mjs';

const TRUCK_SELECT = { id: true, plateNumber: true, driverName: true, driverPhone: true, ownership: true, capacity: true, isActive: true };

// Tankers (Vehicle type 'tanker', shared with the fuel trucks page), each with the one open ATC it may carry.
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  const role = session?.user?.role;
  if (!can(role, 'atc.manage') && !can(role, 'atc.view')) return atcJson({ error: 'Forbidden' }, { status: 403 });
  const trucks = await prisma.vehicle.findMany({
    where: { type: 'tanker' },
    select: { ...TRUCK_SELECT, petroleumAtcs: { where: { status: { in: OPEN_STATUSES } }, select: { id: true, serial: true, status: true }, take: 1 } },
    orderBy: { plateNumber: 'asc' },
  });
  return atcJson({ success: true, data: trucks.map(({ petroleumAtcs, ...truck }) => ({ ...truck, openAtc: petroleumAtcs[0] || null })) });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.manage')) return atcJson({ error: 'You do not have permission to add a tanker' }, { status: 403 });
  try {
    const body = await request.json();
    const plateNumber = String(body.plateNumber || '').trim().toUpperCase();
    const driverName = String(body.driverName || '').trim();
    const driverPhone = String(body.driverPhone || '').trim() || null;
    const capacity = Number(body.capacity);
    if (!plateNumber || !driverName) throw new ApiError('Plate number and driver name are required', 400);
    // An ATC cannot carry more litres than the tanker holds, so the capacity is not optional here.
    if (!Number.isFinite(capacity) || capacity <= 0) throw new ApiError('Enter the tanker capacity in litres', 400);
    if (!['own', 'supplier'].includes(body.ownership)) throw new ApiError('Choose truck ownership', 400);
    if (await prisma.vehicle.findFirst({ where: { plateNumber } })) throw new ApiError('This plate number already exists', 409);

    const truck = await prisma.vehicle.create({ data: { plateNumber, driverName, driverPhone, capacity, ownership: body.ownership, type: 'tanker' }, select: TRUCK_SELECT });
    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.truck.created', entityType: 'Vehicle', entityId: truck.id, after: { plateNumber, driverName, driverPhone, capacity, ownership: body.ownership },
    });
    return atcJson({ success: true, data: { ...truck, openAtc: null } }, { status: 201 });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});
