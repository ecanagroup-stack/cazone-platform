import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { resolvePrice } from '@/lib/pricing';
import { createSaleOrder } from '@/lib/sale';
import { checkCredit } from '@/lib/credit';
import { verifyOtp } from '@/lib/otp';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// Ported from ecana_shop-app's app/admin/sales/new/stonedust + /api/sales' itemType==='stonedust'
// branch — unlike cement (which sells down a pre-recorded ATC allocation), an aggregate sale buys
// straight off the truck: the same transaction both records the quarry purchase (a "received" — not
// allocation — Delivery, same shape petrol/materials deliveries already use, cost = the product's own
// PriceRule, i.e. its "Cost / Tonne" from the Quarries page) AND sells it to the customer in one
// motion, netting to zero stock change but leaving both legs recorded for M6's Quarry Purchases
// report. The truck must be typed 'aggregate' (old app: "registered for cement, not aggregates").
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a sale' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const customerId = body.customerId;
    const productId = body.productId;
    const vehicleId = body.vehicleId;
    const actualQty = Number(body.actualQty);
    const billQty = Number(body.billQty ?? body.actualQty);
    const unitPrice = Math.round(Number(body.unitPrice) * 100);
    const discount = Math.round(Number(body.discount) || 0) * 100;
    const transportFee = Math.round(Number(body.transportFee) || 0) * 100;

    if (!branchId || !customerId || !productId || !vehicleId) throw new ApiError('Branch, customer, product and truck are all required', 400);
    if (!Number.isFinite(actualQty) || actualQty <= 0) throw new ApiError('Quantity must be a positive number', 400);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new ApiError('Sell price per tonne is required', 400);

    const [product, vehicle] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.vehicle.findUnique({ where: { id: vehicleId } }),
    ]);
    if (!product || !product.supplierId) throw new ApiError('Aggregate product not found', 404);
    if (!vehicle) throw new ApiError('Truck not found', 404);
    if (vehicle.type !== 'aggregate') throw new ApiError(`${vehicle.plateNumber} is registered for cement, not aggregates — assign an aggregate truck instead`, 400);

    const { price: costPerUnit } = await resolvePrice(productId);

    // Checked here, before the purchase leg exists, so a rejected/needs-approval sale never leaves a
    // phantom quarry purchase behind — retrying with overrideCredit re-enters this route from
    // scratch rather than reusing anything already committed.
    const grandTotal = Math.round(billQty * unitPrice) - discount + transportFee;
    const decision = await checkCredit({ customerId, orderTotal: grandTotal });
    if (decision.decision === 'blocked') throw new ApiError(decision.reason || 'This customer cannot be sold to on credit', 400);
    if (decision.decision === 'needsApproval' && !body.overrideCredit) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: decision.shortfall, exposure: decision.exposure, available: decision.available,
        error: `This exceeds the customer's credit limit by ${(decision.shortfall / 100).toLocaleString()} — confirm to proceed anyway`,
      });
    }

    if (body.overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });

    const result = await prisma.$transaction(async (tx) => {
      // The purchase leg — buying `actualQty` tonnes from the quarry at its listed cost, delivered by
      // this truck. Not an allocation (no qtyRemaining) — it's received and immediately sold, not held.
      const delivery = await tx.delivery.create({
        data: {
          branchId, supplierId: product.supplierId, vehicleId, productId,
          quantity: actualQty, costPerUnit, totalCost: Math.round(actualQty * costPerUnit),
          status: 'received', receivedAt: new Date(), createdBy: session.user.id,
        },
      });
      await tx.stockMove.create({ data: { branchId, productId, qty: actualQty, reason: 'purchase', ref: delivery.id, userId: session.user.id } });
      return delivery;
    });

    // The sale leg — createSaleOrder runs its own transaction (credit check, Order/OrderLine, the
    // offsetting -actualQty StockMove via stockQty). Not wrapped in the same transaction as the
    // purchase leg above: if the sale is rejected (e.g. credit limit), the truckload has already
    // physically arrived and been paid for at the quarry — same as the old app, nothing to "unbuy."
    const saleResult = await createSaleOrder({
      session, branchId, customerId, paymentMethod: 'credit',
      lines: [{ productId, qty: billQty, stockQty: actualQty, unitPrice }],
      overrideCredit: !!body.overrideCredit,
      discount, transportFee, channel: 'atc',
    });

    if (saleResult.needsApproval) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: saleResult.shortfall, exposure: saleResult.exposure, available: saleResult.available,
        error: `This exceeds the customer's credit limit by ${(saleResult.shortfall / 100).toLocaleString()} — confirm to proceed anyway. The quarry purchase (${result.id}) is already recorded.`,
      });
    }

    if (saleResult.flagged) {
      await notify({ recipientRole: 'owner', type: 'flag_raised', title: 'Credit limit overridden', message: `Sale ${saleResult.order.orderNumber} overrode a customer's credit limit`, relatedType: 'Order', relatedId: saleResult.order.id });
    }

    return NextResponse.json({ success: true, data: { order: saleResult.order, delivery: result, flagged: saleResult.flagged } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
