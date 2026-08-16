import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Explicit manual mark-arrived — loaded -> arrived, ahead of the 6h auto-arrive if staff know the
// vehicle is already back.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'allocations.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage allocations' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery) throw new ApiError('Not found', 404);
    if (delivery.qtyRemaining == null) throw new ApiError('This delivery is not an allocation', 400);
    if (delivery.status !== 'loaded') throw new ApiError(`Cannot mark arrived a delivery that is ${delivery.status}`, 400);

    const updated = await prisma.delivery.update({
      where: { id }, data: { status: 'arrived', arrivalDate: new Date() },
      include: { supplier: true, vehicle: true, product: true },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
