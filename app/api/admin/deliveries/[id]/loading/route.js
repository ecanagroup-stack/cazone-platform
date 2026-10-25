import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { LOADING_WINDOW_MS } from '@/lib/allocation';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { optionalBusinessDate, backdatedAt, assertNotBefore, isBackdated } from '@/lib/saleDates.mjs';
import { effectiveDate } from '@/lib/businessDates.mjs';
import { operatingDateAt } from '@/lib/fuelCollections.mjs';
import { requireBackdateOtp, assertBackdateOtpPresent, notifyBackdated } from '@/lib/backdating';
import { jsonSafe } from '@/lib/jsonSafe';

const HOURS_AGO_OPTIONS = [0, 1, 2, 3, 4, 5];

// Mark an assigned allocation as loaded onto its vehicle — assigned -> loaded. `hoursAgo` lets staff
// backdate the loaded time if they're logging it after the fact (same options the old ATC app gave),
// which also determines when the 6h auto-arrive window (lib/allocation.js) elapses. A loading on an
// earlier day is given as `date` instead (needs the back-dating code, and `hoursAgo` is then ignored).
// Such a load is already past the 6h window, so it lands as arrived: at `arrivalDate` if given (same
// code covers it), otherwise 6h after loading.
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
    if (!delivery || !canAccessBranch(await getAccessibleBranchIds(session), delivery.branchId)) throw new ApiError('Not found', 404);
    if (delivery.qtyRemaining == null) throw new ApiError('This delivery is not an allocation', 400);
    if (delivery.status !== 'assigned') throw new ApiError(`Cannot mark loading for a delivery that is ${delivery.status}`, 400);

    const date = optionalBusinessDate(body.date, 'Loading date');
    assertNotBefore(date, date && (delivery.assignedAt ? operatingDateAt(delivery.assignedAt) : effectiveDate(delivery, 'businessDate')), 'Loading date');
    const arrivalDay = date && isBackdated(date) ? optionalBusinessDate(body.arrivalDate, 'Arrival date') : null;
    assertNotBefore(arrivalDay, arrivalDay && date.toISOString().slice(0, 10), 'Arrival date');
    assertBackdateOtpPresent(date, body.backdateOtp);
    const backdated = await requireBackdateOtp({ userId: session.user.id, date, otp: body.backdateOtp });

    const loadedAt = backdatedAt(date) || new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const alreadyDue = Date.now() - loadedAt.getTime() >= LOADING_WINDOW_MS;
    const arrivalDate = arrivalDay ? backdatedAt(arrivalDay) || new Date() : new Date(loadedAt.getTime() + LOADING_WINDOW_MS);

    const updated = await prisma.delivery.update({
      where: { id },
      data: alreadyDue
        ? { status: 'arrived', loadedAt, arrivalDate }
        : { status: 'loaded', loadedAt },
      include: { supplier: true, vehicle: true, product: true },
    });

    if (backdated) {
      await notifyBackdated({
        actor: session.user, branchId: delivery.branchId, date, relatedType: 'Delivery', relatedId: id,
        what: `the loading of ${updated.atcNumber ? `ATC ${updated.product.abbreviation}-${updated.atcNumber}` : `${updated.product.name} allocation`}`,
      });
    } else if (hoursAgo > 0) {
      await notifyAlteration({
        actor: session.user, branchId: delivery.branchId, type: 'atc_backdated', title: 'ATC loading back-dated',
        message: `${session.user.name} logged an ATC as loaded ${hoursAgo} hour${hoursAgo === 1 ? '' : 's'} ago.`,
        relatedType: 'Delivery', relatedId: id,
      });
    }

    return NextResponse.json(jsonSafe({ success: true, data: updated }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
