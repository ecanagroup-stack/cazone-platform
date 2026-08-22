import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { applyAdjustment } from '@/lib/adjustments';
import { verifyOtp } from '@/lib/otp';
import { ApiError } from '@/lib/apiError';

// A surcharge or fund not tied to any sale — e.g. a standalone penalty/fee or a goodwill credit/
// opening-balance correction. Ported from ecana_shop-app's app/api/customers/[id]/surcharge and
// /refund routes; OTP-gated the same way credit-limit overrides and price approvals are (lib/otp.js),
// which replaced ecana's PIN confirmation platform-wide.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
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

    await verifyOtp({ userId: session.user.id, purpose: 'customer_adjustment', code: body.otp });

    const adjustment = await applyAdjustment({ session, customerId, type, amount, reason });
    return NextResponse.json({ success: true, data: adjustment }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
