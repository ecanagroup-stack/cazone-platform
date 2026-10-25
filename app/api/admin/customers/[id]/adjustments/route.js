import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { applyAdjustment } from '@/lib/adjustments';
import { verifyOtp } from '@/lib/otp';
import { ApiError } from '@/lib/apiError';
import { notifyAlteration, customerBranchIds } from '@/lib/notify';
import { optionalBusinessDate } from '@/lib/saleDates.mjs';
import { requireBackdateOtp, assertBackdateOtpPresent, backdatedNotice } from '@/lib/backdating';

// A surcharge or fund not tied to any sale — e.g. a standalone penalty/fee or a goodwill credit/
// opening-balance correction. Ported from ecana_shop-app's app/api/customers/[id]/surcharge and
// /refund routes; OTP-gated the same way credit-limit overrides and price approvals are (lib/otp.js),
// which replaced ecana's PIN confirmation platform-wide.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customer.adjustments.apply')) {
    return NextResponse.json({ error: 'You do not have permission to adjust a customer balance' }, { status: 403 });
  }
  try {
    const { id: customerId } = await params;
    const body = await request.json();
    const type = body.type === 'refund' ? 'refund' : body.type === 'surcharge' ? 'surcharge' : null;
    if (!type) throw new ApiError('type must be surcharge or refund', 400);

    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(`Enter a valid ${type} amount`, 400);
    const reason = (body.reason || '').trim();
    if (!reason) throw new ApiError('A reason is required', 400);
    const saleDate = optionalBusinessDate(body.saleDate, 'Adjustment date');
    assertBackdateOtpPresent(saleDate, body.backdateOtp);

    await verifyOtp({ userId: session.user.id, purpose: 'customer_adjustment', code: body.otp });
    const backdated = await requireBackdateOtp({ userId: session.user.id, date: saleDate, otp: body.backdateOtp });

    const adjustment = await applyAdjustment({ session, customerId, type, amount, reason, saleDate });
    const notice = {
      actor: session.user, branchIds: await customerBranchIds(customerId), title: type === 'refund' ? 'Customer fund applied' : 'Customer surcharge applied',
      message: `${session.user.name} applied a ${type === 'refund' ? 'fund' : 'surcharge'} of ${(amount / 100).toFixed(2)}. Reason: ${reason}`,
      type: 'customer_adjustment', relatedType: 'CustomerAdjustment', relatedId: adjustment.id,
    };
    await notifyAlteration(backdated ? backdatedNotice(notice, saleDate) : notice);
    return NextResponse.json({ success: true, data: adjustment }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
