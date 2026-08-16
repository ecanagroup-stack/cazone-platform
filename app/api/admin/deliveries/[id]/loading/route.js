import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { LOADING_WINDOW_MS } from '@/lib/allocation';
import { ApiError } from '@/lib/apiError';

const HOURS_AGO_OPTIONS = [0, 1, 2, 3, 4, 5];

// Mark an assigned allocation as loaded onto its vehicle — assigned -> loaded. `hoursAgo` lets staff
// backdate the loaded time if they're logging it after the fact (same options the old ATC app gave),
// which also determines when the 6h auto-arrive window (lib/allocation.js) elapses.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'allocations.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage allocations' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const hoursAgo = HOURS_AGO_OPTIONS.includes(Number(body.hoursAgo)) ? Number(body.hoursAgo) : 0;

    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery) throw new ApiError('Not found', 404);
    if (delivery.qtyRemaining == null) throw new ApiError('This delivery is not an allocation', 400);
    if (delivery.status !== 'assigned') throw new ApiError(`Cannot mark loading for a delivery that is ${delivery.status}`, 400);

    const loadedAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const alreadyDue = Date.now() - loadedAt.getTime() >= LOADING_WINDOW_MS;

    const updated = await prisma.delivery.update({
      where: { id },
      data: alreadyDue
        ? { status: 'arrived', loadedAt, arrivalDate: new Date(loadedAt.getTime() + LOADING_WINDOW_MS) }
        : { status: 'loaded', loadedAt },
      include: { supplier: true, vehicle: true, product: true },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
