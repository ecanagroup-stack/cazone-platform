import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { applyAdjustment } from '@/lib/adjustments';
import { verifyOtp } from '@/lib/otp';
import { ApiError } from '@/lib/apiError';

// A surcharge or fund tied to a specific sale — ported from ecana_shop-app's
// app/api/sales/[id]/surcharge and /refund routes. `method` on a surcharge picks how the amount is
// computed: per_unit (rate x total billed qty across the order's lines), flat_total, or transport
// (both just the amount given outright); a fund always takes the amount given outright (method
// 'shortfall', matching ecana). OTP-gated like the standalone version (app/api/admin/customers/[id]/adjustments).
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to adjust a sale' }, { status: 403 });
  }
  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const type = body.type === 'refund' ? 'refund' : body.type === 'surcharge' ? 'surcharge' : null;
    if (!type) throw new ApiError('type must be surcharge or refund', 400);
    const reason = (body.reason || '').trim();
    if (!reason) throw new ApiError('A reason is required', 400);

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!order) throw new ApiError('Order not found', 404);
    if (order.status === 'void') throw new ApiError('Cannot adjust a voided order', 400);
    if (order.channel === 'shop') throw new ApiError(`${type === 'surcharge' ? 'Surcharges' : 'Funds'} do not apply to shop sales`, 400);
    if (!order.customerId) throw new ApiError('This order has no customer to adjust', 400);

    let amount, method;
    if (type === 'surcharge') {
      method = body.method === 'per_unit' ? 'per_unit' : body.method === 'transport' ? 'transport' : 'flat_total';
      if (method === 'per_unit') {
        const qty = order.lines.reduce((sum, l) => sum + l.qty, 0);
        amount = Math.round(Number(body.perUnitAmount) * qty);
      } else {
        amount = Math.round(Number(body.totalAmount));
      }
    } else {
      method = 'shortfall';
      amount = Math.round(Number(body.amount));
    }
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(`Enter a valid ${type} amount`, 400);

    await verifyOtp({ userId: session.user.id, purpose: 'customer_adjustment', code: body.otp });

    const adjustment = await applyAdjustment({ session, customerId: order.customerId, orderId, type, method, amount, reason });
    return NextResponse.json({ success: true, data: adjustment }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
