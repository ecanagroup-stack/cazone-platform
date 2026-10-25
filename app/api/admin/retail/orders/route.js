import { NextResponse } from 'next/server';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { createSaleOrder } from '@/lib/sale';
import { verifyOtp } from '@/lib/otp';
import { notifyAlteration } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';
import { requireBackdateOtp, assertBackdateOtpPresent, notifyBackdated } from '@/lib/backdating';
import { optionalBusinessDate } from '@/lib/saleDates.mjs';

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
    const saleDate = optionalBusinessDate(body.saleDate, 'Sale date');
    assertBackdateOtpPresent(saleDate, body.backdateOtp);
    // Both single-use codes are spent together, after createSaleOrder has run its own checks.
    let backdated = false;
    const result = await createSaleOrder({
      session,
      branchId: body.branchId,
      customerId: body.customerId || null,
      paymentMethod: body.paymentMethod || 'cash',
      // Only product and quantity from the client: prices (and stock sources) are the server's call.
      lines: Array.isArray(body.lines) ? body.lines.map((l) => ({ productId: l.productId, qty: l.qty })) : [],
      overrideCredit: !!body.overrideCredit,
      beforeWrite: async () => {
        if (body.overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });
        backdated = await requireBackdateOtp({ userId: session.user.id, date: saleDate, otp: body.backdateOtp });
      },
      channel: 'retail', saleDate,
    });

    if (result.needsApproval) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: result.shortfall, exposure: result.exposure, available: result.available,
        error: `This exceeds the customer's credit limit by ${(result.shortfall / 100).toLocaleString()} — confirm to proceed anyway`,
      });
    }

    if (body.overrideCredit) await notifyAlteration({ actor: session.user, branchId: body.branchId, type: 'credit_override', title: 'Credit override used', message: `${session.user.name} used a verification code for sale ${result.order.orderNumber}.`, relatedType: 'Order', relatedId: result.order.id });

    if (backdated) await notifyBackdated({
      actor: session.user, branchId: body.branchId, date: saleDate, relatedType: 'Order', relatedId: result.order.id,
      what: `sale ${result.order.orderNumber}`,
    });

    return NextResponse.json({ success: true, data: { order: result.order, flagged: result.flagged } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
