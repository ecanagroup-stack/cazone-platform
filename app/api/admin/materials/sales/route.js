import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { resolvePrice } from '@/lib/pricing';
import { isAllocationSellable } from '@/lib/allocation';
import { createSaleOrder, priceLines, assertCustomerAccessible, assertBranchAccessible } from '@/lib/sale';
import { checkCredit } from '@/lib/credit';
import { verifyOtp } from '@/lib/otp';
import { notifyAlteration } from '@/lib/notify';
import { requireBackdateOtp, assertBackdateOtpPresent, notifyBackdated } from '@/lib/backdating';
import { ApiError } from '@/lib/apiError';
import { materialSaleDates, backdatedAt } from '@/lib/saleDates.mjs';
import { toCents } from '@/lib/money.mjs';
import { jsonSafe } from '@/lib/jsonSafe';

// A combined materials sale — one customer, one order, any mix of cement (sold down a pre-recorded
// ATC allocation, see sales/cement) and aggregate (bought off the truck from the quarry and sold in
// the same motion, see sales/aggregate) items, replacing those two single-product flows. Each item
// carries its own transport fee and any number of labour/other costs (a cement ATC and an aggregate
// truck are two different deliveries with their own costs) — lib/sale.js's priceLines/createSaleOrder
// roll those into the order's transportFee/labourFee/otherFee totals; discount stays a single
// whole-order figure, same as the old aggregate flow. Unit prices are not part of the request: they
// are always resolved server-side from the price list (lib/sale.js priceLines).

function centsCosts(costs) {
  return (Array.isArray(costs) ? costs : [])
    .filter((c) => c && Number(c.amount) > 0)
    .map((c) => ({ type: c.type === 'labour' ? 'labour' : 'other', amount: toCents(c.amount), detail: (c.detail || '').trim() || null }));
}

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'sales.record')) {
    return NextResponse.json({ error: 'You do not have permission to record a sale' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const customerId = body.customerId;
    const items = Array.isArray(body.items) ? body.items : [];
    if (body.delivered != null && typeof body.delivered !== 'boolean') throw new ApiError('Delivered must be true or false', 400);
    const deliveryStatus = body.delivered ? 'delivered' : 'pending';
    const { saleDate, deliveryDate } = materialSaleDates(body);
    const rawDiscount = body.discount ?? 0;
    if (!Number.isFinite(Number(rawDiscount)) || Number(rawDiscount) < 0) throw new ApiError('Discount must be zero or more', 400);
    const discount = toCents(rawDiscount);

    if (!branchId || !customerId) throw new ApiError('Branch and customer are required', 400);
    if (items.length === 0) throw new ApiError('Add at least one item', 400);
    // Checked here as well as in createSaleOrder: that runs after the codes are spent and the quarry
    // purchases are recorded, and a sale refused then would leave both behind.
    await assertBranchAccessible(session, branchId);
    await assertCustomerAccessible(branchId, customerId);
    assertBackdateOtpPresent(saleDate, body.backdateOtp);

    // Resolve every item to a productId (and, for aggregate, the purchase leg it'll need) before
    // pricing/credit — no writes yet, so a rejected sale leaves nothing behind.
    const resolved = [];
    const drawnFromAtc = new Map(); // atcId -> bags already requested by earlier items in this sale
    for (const item of items) {
      if (item.kind === 'cement') {
        const atc = await prisma.delivery.findUnique({ where: { id: item.atcId }, include: { vehicle: true, supplier: true, product: true } });
        if (!atc || atc.qtyRemaining == null) throw new ApiError('ATC not found', 404);
        if (atc.branchId !== branchId) throw new ApiError('That ATC belongs to a different branch', 400);
        const actualQty = Number(item.actualQty);
        if (!Number.isFinite(actualQty) || actualQty <= 0) throw new ApiError('Quantity supplied must be a positive number', 400);
        // Same checks createSaleOrder's stock step makes, done up front so a sale that can't be
        // fulfilled fails before a verification code is spent or a quarry purchase is recorded.
        const atcLabel = [atc.product?.abbreviation, atc.atcNumber].filter(Boolean).join('-') || 'selected';
        if (!isAllocationSellable(atc)) throw new ApiError(`The ${atcLabel} ATC is not available to sell from`, 400);
        const requested = (drawnFromAtc.get(atc.id) || 0) + actualQty;
        if (requested > atc.qtyRemaining) throw new ApiError(`Only ${atc.qtyRemaining} bags remaining on the ${atcLabel} ATC`, 400);
        drawnFromAtc.set(atc.id, requested);
        resolved.push({
          kind: 'cement',
          line: {
            productId: atc.productId, qty: Number(item.billQty ?? item.actualQty), stockQty: actualQty, allocationId: atc.id,
            transportFee: toCents(item.transportFee), costs: centsCosts(item.costs),
            sourceTruckNumber: atc.vehicle?.plateNumber, sourceDriverName: atc.vehicle?.driverName,
            sourceName: atc.supplier?.name, quality: atc.product?.attributes?.grade || null,
          },
        });
      } else if (item.kind === 'aggregate') {
        const [product, vehicle] = await Promise.all([
          prisma.product.findUnique({ where: { id: item.productId }, include: { supplier: true } }),
          prisma.vehicle.findUnique({ where: { id: item.vehicleId } }),
        ]);
        if (!product || !product.supplierId) throw new ApiError('Aggregate product not found', 404);
        if (!vehicle) throw new ApiError('Truck not found', 404);
        if (vehicle.type !== 'aggregate') throw new ApiError(`${vehicle.plateNumber} is registered for cement, not aggregates — assign an aggregate truck instead`, 400);
        const actualQty = Number(item.actualQty);
        if (!Number.isFinite(actualQty) || actualQty <= 0) throw new ApiError('Quantity must be a positive number', 400);
        // The product's list price is the quarry's per-tonne cost (the purchase leg below), not a selling
        // price, so an aggregate is sold at the customer's own rate for it and nothing else.
        const sellRule = await prisma.priceRule.findFirst({ where: { productId: product.id, customerId, branchId: null, validTo: null } });
        if (!sellRule) throw new ApiError(`No selling price set for ${product.name} for this customer — set their rate under Customers > Pricing first`, 400);
        const { price: costPerUnit } = await resolvePrice(product.id);
        resolved.push({
          kind: 'aggregate',
          purchase: { productId: product.id, supplierId: product.supplierId, vehicleId: vehicle.id, actualQty, costPerUnit },
          line: {
            productId: product.id, qty: Number(item.billQty ?? item.actualQty), stockQty: actualQty,
            transportFee: toCents(item.transportFee), costs: centsCosts(item.costs),
            sourceTruckNumber: vehicle.plateNumber, sourceDriverName: vehicle.driverName,
            sourceName: product.supplier?.name, quality: product.attributes?.size || null,
          },
        });
      } else {
        throw new ApiError('Each item needs a kind of cement or aggregate', 400);
      }
    }

    // Priced (not persisted) purely to compute the credit-check total before any purchase leg
    // exists — mirrors sales/aggregate's ordering, extended to N aggregate legs.
    const { subtotal } = await priceLines(resolved.map((r) => r.line), customerId);
    const totalTransportFee = resolved.reduce((s, r) => s + r.line.transportFee, 0);
    const totalLabourFee = resolved.reduce((s, r) => s + r.line.costs.filter((c) => c.type === 'labour').reduce((cs, c) => cs + c.amount, 0), 0);
    const totalOtherFee = resolved.reduce((s, r) => s + r.line.costs.filter((c) => c.type === 'other').reduce((cs, c) => cs + c.amount, 0), 0);
    const grandTotal = subtotal - discount + totalTransportFee + totalLabourFee + totalOtherFee;
    if (discount > subtotal) throw new ApiError('Discount cannot exceed the sale subtotal', 400);

    const decision = await checkCredit({ customerId, orderTotal: grandTotal });
    if (decision.decision === 'blocked') throw new ApiError(decision.reason || 'This customer cannot be sold to on credit', 400);
    if (decision.decision === 'needsApproval' && !body.overrideCredit) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: decision.shortfall, exposure: decision.exposure, available: decision.available,
        error: `This exceeds the customer's credit limit by ${(decision.shortfall / 100).toLocaleString()} — confirm to proceed anyway`,
      });
    }
    // Everything above can reject the sale, so the single-use codes are spent only now.
    if (body.overrideCredit) await verifyOtp({ userId: session.user.id, purpose: 'credit_override', code: body.otp });
    let discountOtpVerified = false;
    if (discount > 0) {
      await verifyOtp({ userId: session.user.id, purpose: 'sale_discount', code: body.discountOtp });
      discountOtpVerified = true;
    }
    const backdated = await requireBackdateOtp({ userId: session.user.id, date: saleDate, otp: body.backdateOtp });

    // The purchase leg for every aggregate item — buying straight from the quarry at its listed cost,
    // delivered by that item's truck. Not wrapped with the sale below: if the sale is rejected after
    // this point, the truckload has already physically arrived and been paid for, same as the old
    // single-item aggregate flow — nothing to "unbuy."
    // For a back-dated sale the truckload arrived on the sale's day, so the stock-in matches the stock-out.
    const purchaseAt = backdatedAt(saleDate);
    const deliveries = [];
    for (const r of resolved) {
      if (r.kind !== 'aggregate') continue;
      const { productId, supplierId, vehicleId, actualQty, costPerUnit } = r.purchase;
      const totalCostNumber = Math.round(actualQty * costPerUnit);
      if (!Number.isSafeInteger(totalCostNumber)) throw new ApiError('Total delivery cost is too large to record safely', 400);
      const delivery = await prisma.$transaction(async (tx) => {
        const d = await tx.delivery.create({
          data: {
            branchId, supplierId, vehicleId, productId,
            quantity: actualQty, costPerUnit, totalCost: BigInt(totalCostNumber),
            status: 'received', receivedAt: purchaseAt || new Date(), createdBy: session.user.id, businessDate: purchaseAt,
          },
        });
        await tx.stockMove.create({ data: { branchId, productId, qty: actualQty, reason: 'purchase', ref: d.id, userId: session.user.id, ...(purchaseAt ? { at: purchaseAt } : {}) } });
        return d;
      });
      deliveries.push(delivery);
    }

    const result = await createSaleOrder({
      session, branchId, customerId, paymentMethod: 'credit',
      lines: resolved.map((r) => r.line),
      overrideCredit: !!body.overrideCredit,
      discount, discountOtpVerified, channel: 'atc', deliveryStatus, saleDate, deliveryDate,
    });

    if (result.needsApproval) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: result.shortfall, exposure: result.exposure, available: result.available,
        error: `This exceeds the customer's credit limit by ${(result.shortfall / 100).toLocaleString()} — confirm to proceed anyway${deliveries.length ? '. The quarry purchase(s) are already recorded.' : ''}`,
      });
    }

    if (body.overrideCredit) await notifyAlteration({ actor: session.user, branchId, type: 'credit_override', title: 'Credit override used', message: `${session.user.name} used a verification code for sale ${result.order.orderNumber}.`, relatedType: 'Order', relatedId: result.order.id });
    if (discount > 0) await notifyAlteration({
      actor: session.user, branchId, title: 'Sale discount applied',
      message: `${session.user.name} applied a discount of ${(discount / 100).toFixed(2)} to sale ${result.order.orderNumber}.`,
      type: 'sale_discount', relatedType: 'Order', relatedId: result.order.id,
    });

    if (backdated) await notifyBackdated({
      actor: session.user, branchId, date: saleDate, relatedType: 'Order', relatedId: result.order.id,
      what: `sale ${result.order.orderNumber}`,
    });

    return NextResponse.json(jsonSafe({ success: true, data: { order: result.order, deliveries, flagged: result.flagged } }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
