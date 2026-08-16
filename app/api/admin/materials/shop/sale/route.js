import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { createSaleOrder } from '@/lib/sale';
import { verifyOtp } from '@/lib/otp';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Cement Warehouse's "Record Sale" tab (ecana_shop-app's app/admin/shop's sell tab + /api/sales'
// itemType==='shop' branch) — the one Cement Warehouse flow that's a real cart (multiple lines),
// unlike the single-line cement/aggregate sale flows. "Pay Now" (cash/transfer/pos/cheque) vs
// "Move to Account" (credit) mirrors the old app's radio exactly; a walk-in (no customer picked)
// can only pay now — there's no account to bill.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a sale' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const customerId = body.customerId || null;
    const paymentMethod = body.paymentMethod || 'cash';
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const transportFee = Math.round(Number(body.transportFee) || 0) * 100;

    if (!branchId) throw new ApiError('branchId is required', 400);
    if (lines.length === 0) throw new ApiError('Add at least one item', 400);
    if (!customerId && paymentMethod === 'credit') throw new ApiError('Walk-in sales must be paid immediately — select a customer to move this to their account', 400);

    const priceLines = lines.map((l) => ({
      productId: l.productId,
      qty: Number(l.billQty ?? l.qty), // billed drives price
      stockQty: Number(l.qty), // actual supplied drives the stock move
      unitPrice: Math.round(Number(l.unitPrice) * 100),
    }));

    if (body.overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });

    const result = await createSaleOrder({
      session, branchId, customerId, paymentMethod,
      lines: priceLines,
      overrideCredit: !!body.overrideCredit,
      transportFee, channel: 'shop',
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
