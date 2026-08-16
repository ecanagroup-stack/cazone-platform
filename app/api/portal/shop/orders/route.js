import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { createPendingOrder } from '@/lib/sale';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Self-service order placement — sits `pending` until staff confirms it (app/admin/materials'
// pending-orders queue), never trusting a portal session to directly move stock or a balance.
export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);
    const body = await request.json();
    const result = await createPendingOrder({
      session,
      branchId: body.branchId,
      customerId: session.user.customerId,
      lines: Array.isArray(body.lines) ? body.lines : [],
      channel: 'shop',
    });
    await notify({
      recipientRole: 'owner', type: 'pending_order', title: 'New online order',
      message: `Order ${result.order.orderNumber} was placed via the customer portal and needs confirming`,
      relatedType: 'Order', relatedId: result.order.id,
    });

    return NextResponse.json({ success: true, data: result.order }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
