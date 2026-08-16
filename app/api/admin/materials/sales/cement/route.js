import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { createSaleOrder } from '@/lib/sale';
import { verifyOtp } from '@/lib/otp';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Ported from ecana_shop-app's cement-sale flow (app/admin/sales/new/cement + /api/sales'
// itemType==='cement' branch) — one call per customer distribution, matching how the old app's page
// itself loops over its "Distribution Summary" and calls its sale endpoint once each. Always a credit
// sale (an ATC distribution goes on the customer's account, same as the old app hardcoding
// paymentMethod: 'balance' for every non-shop sale type) — lib/sale.js's createSaleOrder does the
// actual pricing/credit/stock work, this is just the HTTP wrapper plus the one thing specific to this
// flow: qty (billed, drives price) and stockQty (actual bags handed over, drives the ATC's
// qtyRemaining) can differ, and price is whatever was manually agreed for this distribution, not
// necessarily the brand's catalog price.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a sale' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const atcId = body.atcId;
    const customerId = body.customerId;
    const billQty = Number(body.billQty ?? body.actualQty);
    const actualQty = Number(body.actualQty);
    const unitPrice = Math.round(Number(body.unitPrice) * 100);
    const transportFee = Math.round(Number(body.transportFee) || 0) * 100;

    if (!atcId || !customerId) throw new ApiError('An ATC and a customer are required', 400);
    if (!Number.isFinite(actualQty) || actualQty <= 0) throw new ApiError('Quantity supplied must be a positive number', 400);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new ApiError('Price per bag is required', 400);

    const atc = await prisma.delivery.findUnique({ where: { id: atcId } });
    if (!atc || atc.qtyRemaining == null) throw new ApiError('ATC not found', 404);

    if (body.overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });

    const result = await createSaleOrder({
      session,
      branchId: atc.branchId,
      customerId,
      paymentMethod: 'credit',
      lines: [{ productId: atc.productId, qty: billQty, stockQty: actualQty, unitPrice, allocationId: atcId }],
      overrideCredit: !!body.overrideCredit,
      transportFee,
      channel: 'atc',
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
