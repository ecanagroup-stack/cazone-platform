import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { optionalBusinessDate, backdatedAt, assertNotBefore } from '@/lib/saleDates.mjs';
import { requireBackdateOtp, assertBackdateOtpPresent, notifyBackdated } from '@/lib/backdating';
import { operatingDateAt } from '@/lib/fuelCollections.mjs';
import { jsonSafe } from '@/lib/jsonSafe';

// Explicit manual mark-arrived — loaded -> arrived, ahead of the 6h auto-arrive if staff know the
// vehicle is already back. `date` records a past arrival (needs the back-dating code); blank means now.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'allocations.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage allocations' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const delivery = await prisma.delivery.findUnique({ where: { id } });
    if (!delivery || !canAccessBranch(await getAccessibleBranchIds(session), delivery.branchId)) throw new ApiError('Not found', 404);
    if (delivery.qtyRemaining == null) throw new ApiError('This delivery is not an allocation', 400);
    if (delivery.status !== 'loaded') throw new ApiError(`Cannot mark arrived a delivery that is ${delivery.status}`, 400);

    const date = optionalBusinessDate(body.date, 'Arrival date');
    assertNotBefore(date, date && delivery.loadedAt && operatingDateAt(delivery.loadedAt), 'Arrival date');
    assertBackdateOtpPresent(date, body.backdateOtp);
    const backdated = await requireBackdateOtp({ userId: session.user.id, date, otp: body.backdateOtp });

    const updated = await prisma.delivery.update({
      where: { id }, data: { status: 'arrived', arrivalDate: backdatedAt(date) || new Date() },
      include: { supplier: true, vehicle: true, product: true },
    });

    if (backdated) await notifyBackdated({
      actor: session.user, branchId: delivery.branchId, date, relatedType: 'Delivery', relatedId: id,
      what: `the arrival of ${updated.atcNumber ? `ATC ${updated.product.abbreviation}-${updated.atcNumber}` : `${updated.product.name} allocation`}`,
    });

    return NextResponse.json(jsonSafe({ success: true, data: updated }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
