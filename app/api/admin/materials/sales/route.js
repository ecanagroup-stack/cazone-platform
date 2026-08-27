import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { resolvePrice } from '@/lib/pricing';
import { createSaleOrder, priceLines } from '@/lib/sale';
import { checkCredit } from '@/lib/credit';
import { verifyOtp } from '@/lib/otp';
import { notify } from '@/lib/notify';
import { ApiError } from '@/lib/apiError';

// A combined materials sale — one customer, one order, any mix of cement (sold down a pre-recorded
// ATC allocation, see sales/cement) and aggregate (bought off the truck from the quarry and sold in
// the same motion, see sales/aggregate) items, replacing those two single-product flows. Each item
// carries its own transport fee and any number of labour/other costs (a cement ATC and an aggregate
// truck are two different deliveries with their own costs) — lib/sale.js's priceLines/createSaleOrder
// roll those into the order's transportFee/labourFee/otherFee totals; discount stays a single
// whole-order figure, same as the old aggregate flow.
const toCents = (v) => Math.round(Number(v) || 0) * 100;
const toCentsPrice = (v) => Math.round(Number(v) * 100);

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
    const discount = toCents(body.discount);

    if (!branchId || !customerId) throw new ApiError('Branch and customer are required', 400);
    if (items.length === 0) throw new ApiError('Add at least one item', 400);

    // Resolve every item to a productId (and, for aggregate, the purchase leg it'll need) before
    // pricing/credit — no writes yet, so a rejected sale leaves nothing behind.
    const resolved = [];
    for (const item of items) {
      if (item.kind === 'cement') {
        const atc = await prisma.delivery.findUnique({ where: { id: item.atcId } });
        if (!atc || atc.qtyRemaining == null) throw new ApiError('ATC not found', 404);
        if (atc.branchId !== branchId) throw new ApiError('That ATC belongs to a different branch', 400);
        const actualQty = Number(item.actualQty);
        const unitPrice = toCentsPrice(item.unitPrice);
        if (!Number.isFinite(actualQty) || actualQty <= 0) throw new ApiError('Quantity supplied must be a positive number', 400);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new ApiError('Price per bag is required', 400);
        resolved.push({
          kind: 'cement',
          line: {
            productId: atc.productId, qty: Number(item.billQty ?? item.actualQty), stockQty: actualQty, unitPrice, allocationId: atc.id,
            transportFee: toCents(item.transportFee), costs: centsCosts(item.costs),
          },
        });
      } else if (item.kind === 'aggregate') {
        const [product, vehicle] = await Promise.all([
          prisma.product.findUnique({ where: { id: item.productId } }),
          prisma.vehicle.findUnique({ where: { id: item.vehicleId } }),
        ]);
        if (!product || !product.supplierId) throw new ApiError('Aggregate product not found', 404);
        if (!vehicle) throw new ApiError('Truck not found', 404);
        if (vehicle.type !== 'aggregate') throw new ApiError(`${vehicle.plateNumber} is registered for cement, not aggregates — assign an aggregate truck instead`, 400);
        const actualQty = Number(item.actualQty);
        const unitPrice = toCentsPrice(item.unitPrice);
        if (!Number.isFinite(actualQty) || actualQty <= 0) throw new ApiError('Quantity must be a positive number', 400);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new ApiError('Sell price per tonne is required', 400);
        const { price: costPerUnit } = await resolvePrice(product.id);
        resolved.push({
          kind: 'aggregate',
          purchase: { productId: product.id, supplierId: product.supplierId, vehicleId: vehicle.id, actualQty, costPerUnit },
          line: {
            productId: product.id, qty: Number(item.billQty ?? item.actualQty), stockQty: actualQty, unitPrice,
            transportFee: toCents(item.transportFee), costs: centsCosts(item.costs),
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

    // The purchase leg for every aggregate item — buying straight from the quarry at its listed cost,
    // delivered by that item's truck. Not wrapped with the sale below: if the sale is rejected after
    // this point, the truckload has already physically arrived and been paid for, same as the old
    // single-item aggregate flow — nothing to "unbuy."
    const deliveries = [];
    for (const r of resolved) {
      if (r.kind !== 'aggregate') continue;
      const { productId, supplierId, vehicleId, actualQty, costPerUnit } = r.purchase;
      const delivery = await prisma.$transaction(async (tx) => {
        const d = await tx.delivery.create({
          data: {
            branchId, supplierId, vehicleId, productId,
            quantity: actualQty, costPerUnit, totalCost: Math.round(actualQty * costPerUnit),
            status: 'received', receivedAt: new Date(), createdBy: session.user.id,
          },
        });
        await tx.stockMove.create({ data: { branchId, productId, qty: actualQty, reason: 'purchase', ref: d.id, userId: session.user.id } });
        return d;
      });
      deliveries.push(delivery);
    }

    const result = await createSaleOrder({
      session, branchId, customerId, paymentMethod: 'credit',
      lines: resolved.map((r) => r.line),
      overrideCredit: !!body.overrideCredit,
      discount, channel: 'atc',
    });

    if (result.needsApproval) {
      return NextResponse.json({
        success: false, needsApproval: true,
        shortfall: result.shortfall, exposure: result.exposure, available: result.available,
        error: `This exceeds the customer's credit limit by ${(result.shortfall / 100).toLocaleString()} — confirm to proceed anyway${deliveries.length ? '. The quarry purchase(s) are already recorded.' : ''}`,
      });
    }

    if (result.flagged) {
      await notify({ recipientRole: 'owner', type: 'flag_raised', title: 'Credit limit overridden', message: `Sale ${result.order.orderNumber} overrode a customer's credit limit`, relatedType: 'Order', relatedId: result.order.id });
    }

    return NextResponse.json({ success: true, data: { order: result.order, deliveries, flagged: result.flagged } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
