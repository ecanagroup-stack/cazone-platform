import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { confirmPendingOrder } from '@/lib/sale';
import { verifyOtp } from '@/lib/otp';
import { notifyReviewers } from '@/lib/notify';

export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to confirm a sale' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });
    const result = await confirmPendingOrder({ session, orderId: id, overrideCredit: !!body.overrideCredit });

    if (result.needsApproval) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: result.shortfall, exposure: result.exposure, available: result.available,
        error: `This exceeds the customer's credit limit by ${(result.shortfall / 100).toLocaleString()} — confirm to proceed anyway`,
      });
    }

    if (body.overrideCredit) await notifyReviewers({ actorUserId: session.user.id, type: 'credit_override', title: 'Credit override used', message: `${session.user.name} used a verification code to confirm order ${result.order.orderNumber}.`, relatedType: 'Order', relatedId: result.order.id });

    return NextResponse.json({ success: true, data: { order: result.order, flagged: result.flagged } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
