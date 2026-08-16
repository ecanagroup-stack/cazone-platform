import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { createSaleOrder } from '@/lib/sale';
import { verifyOtp } from '@/lib/otp';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// General Retail Store's checkout — separate route from materials/orders so the URL namespace
// matches the pack, even though the underlying sale logic (lib/sale.js) is shared with materials
// and fuel. Tags the sale channel: 'retail', distinct from Materials' 'shop'/'atc'.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a sale' }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (body.overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });
    const result = await createSaleOrder({
      session,
      branchId: body.branchId,
      customerId: body.customerId || null,
      paymentMethod: body.paymentMethod || 'cash',
      lines: Array.isArray(body.lines) ? body.lines : [],
      overrideCredit: !!body.overrideCredit,
      channel: 'retail',
    });

    if (result.needsApproval) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: result.shortfall, exposure: result.exposure, available: result.available,
        error: `This exceeds the customer's credit limit by ${(result.shortfall / 100).toLocaleString()} — confirm to proceed anyway`,
      });
    }

    if (result.flagged) {
      await notify({ recipientRole: 'owner', type: 'flag_raised', title: 'Credit limit overridden', message: `Sale ${result.order.orderNumber} overrode a customer's credit limit`, relatedType: 'Order', relatedId: result.order.id });
    }

    return NextResponse.json({ success: true, data: { order: result.order, flagged: result.flagged } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
