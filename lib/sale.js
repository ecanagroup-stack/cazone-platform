import prisma from './prisma';
import { resolvePrice } from './pricing';
import { checkCredit } from './credit';
import { ApiError } from './apiError';

// A customer is only a valid sale target at a branch they're registered/shared to (CustomerAccess —
// see prisma/schema.prisma). Checked here, not just in the picker UI, so a stale client-side list or
// a direct API call can't sell to a customer who was never tagged to this branch.
async function assertCustomerAccessible(branchId, customerId) {
  if (!customerId) return;
  const access = await prisma.customerAccess.findUnique({ where: { customerId_branchId: { customerId, branchId } } });
  if (!access) throw new ApiError('This customer is not registered at this branch', 400);
}

// `line.unitPrice` lets a caller override the product's live PriceRule with a manually-entered price
// (ecana_shop-app's cement/aggregate sale forms let staff type a negotiated price per sale rather
// than always trusting the catalog price) — omit it to resolve normally. When it IS omitted,
// `customerId` (if given) lets resolvePrice prefer that customer's own negotiated rate over the list
// price — the Cement/Aggregate Sale forms always pass unitPrice explicitly, so this never changes
// their behavior; only callers that resolve automatically (the customer's own Shop orders, and any
// other sale that doesn't override price) pick up a customer's standing rate. `line.stockQty`
// similarly lets the *billed* quantity (drives pricing/lineTotal) differ from the *actual* quantity
// physically supplied (drives the stock/allocation decrement, in applyLineStock below) — omit it and
// they're the same, again unchanged by default. `line.transportFee`/`line.costs` (a combined
// materials sale's per-item transport/labour/other, already in cents) just pass through untouched —
// they don't affect this line's own lineTotal/subtotal, only the order-level totals createSaleOrder
// rolls them into.
export async function priceLines(lines, customerId) {
  const priced = [];
  let subtotal = 0;
  for (const line of lines) {
    const qty = Number(line.qty);
    if (!line.productId || !Number.isFinite(qty) || qty <= 0) throw new ApiError('Every line needs a product and a positive quantity', 400);
    let price, priceRuleId = null;
    if (line.unitPrice != null) {
      price = Math.round(Number(line.unitPrice));
      if (!Number.isFinite(price) || price < 0) throw new ApiError('Invalid price', 400);
    } else {
      ({ price, priceRuleId } = await resolvePrice(line.productId, customerId));
    }
    const lineTotal = Math.round(qty * price);
    subtotal += lineTotal;
    const stockQty = line.stockQty != null ? Number(line.stockQty) : qty;
    if (!Number.isFinite(stockQty) || stockQty <= 0) throw new ApiError('Invalid supplied quantity', 400);
    const lineTransportFee = Math.round(Number(line.transportFee) || 0);
    const costs = Array.isArray(line.costs)
      ? line.costs.map((c) => ({ type: c.type === 'labour' ? 'labour' : 'other', amount: Math.round(Number(c.amount) || 0), detail: c.detail || null })).filter((c) => c.amount > 0)
      : [];
    priced.push({ productId: line.productId, qty, unitPrice: price, lineTotal, priceRuleId, allocationId: line.allocationId || null, stockQty, transportFee: lineTransportFee, costs });
  }
  return { priced, subtotal };
}

// Applies one priced line's stock effect inside an open transaction. A line referencing a supply
// allocation (lib/allocation.js) draws down Delivery.qtyRemaining instead of creating an ordinary
// purchase-backed stock move — that batch was never received into general stock, so there's nothing
// to decrement there; it's consumed directly, same as the old ATC app. Auto-closes the allocation at
// zero. Returns the channel this line's StockMove should carry ('atc' when allocation-sourced,
// otherwise the order's own channel). Decrements by `p.stockQty` (actual supplied), not `p.qty`
// (billed) — see priceLines above.
async function applyLineStock(tx, { branchId, p, reason, ref, userId, defaultChannel }) {
  let channel = defaultChannel;
  if (p.allocationId) {
    channel = 'atc';
    const allocation = await tx.delivery.findUnique({ where: { id: p.allocationId } });
    if (!allocation || allocation.qtyRemaining == null) throw new ApiError('Allocation not found', 400);
    if (!['loaded', 'arrived'].includes(allocation.status)) throw new ApiError('This allocation is not yet available to sell from', 400);
    if (p.stockQty > allocation.qtyRemaining) throw new ApiError(`Only ${allocation.qtyRemaining} remaining on this allocation`, 400);
    const remaining = allocation.qtyRemaining - p.stockQty;
    await tx.delivery.update({ where: { id: p.allocationId }, data: { qtyRemaining: remaining, status: remaining === 0 ? 'closed' : allocation.status } });
  }
  await tx.stockMove.create({ data: { branchId, productId: p.productId, qty: -p.stockQty, reason, ref, userId, channel } });
  return channel;
}

// Shared sale-creation transaction: prices each line, runs a credit check for credit sales (never
// hard-blocks — returns needsApproval so the caller's route can surface the shortfall to the user),
// then creates the Order/OrderLines, one StockMove per line, updates the customer's balance for
// credit sales, and raises a Flag if a credit shortfall was overridden. Originally the materials
// counter's checkout; the fuel pack's credit-fill action reuses it rather than reimplementing
// pricing/credit/stock — the only per-pack difference is which branch/product/customer gets passed in.
export async function createSaleOrder({ session, branchId, customerId, paymentMethod, lines, overrideCredit, stockReason = 'sale', channel, transportFee = 0, labourFee = 0, otherFee = 0, discount = 0, onOrderCreated }) {
  if (!branchId) throw new ApiError('branchId is required', 400);
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError('Add at least one product', 400);
  if (paymentMethod === 'credit' && !customerId) throw new ApiError('A customer is required for a credit sale', 400);
  await assertCustomerAccessible(branchId, customerId);

  const { priced, subtotal } = await priceLines(lines, customerId);
  const roundedDiscount = Math.round(Number(discount) || 0);
  // Order-level total = whatever was passed once for the whole order (the old single-product
  // flows' behavior) plus whatever any line carried of its own (a combined materials sale's
  // per-item transport/labour/other) — see priceLines above and OrderLine.transportFee/costs.
  const totalTransportFee = Math.round(Number(transportFee) || 0) + priced.reduce((s, p) => s + p.transportFee, 0);
  const totalLabourFee = Math.round(Number(labourFee) || 0) + priced.reduce((s, p) => s + p.costs.filter((c) => c.type === 'labour').reduce((cs, c) => cs + c.amount, 0), 0);
  const totalOtherFee = Math.round(Number(otherFee) || 0) + priced.reduce((s, p) => s + p.costs.filter((c) => c.type === 'other').reduce((cs, c) => cs + c.amount, 0), 0);
  const grandTotal = subtotal - roundedDiscount + totalTransportFee + totalLabourFee + totalOtherFee;
  // A sale that draws from any allocation is classified 'atc' overall (matches the old app's "mixed
  // sales still count as the wholesale channel") even if the order also has line requesting
  // `channel`; per-line StockMove.channel stays precise regardless (see applyLineStock).
  const effectiveChannel = priced.some((p) => p.allocationId) ? 'atc' : channel;

  let creditFlag = false;
  if (paymentMethod === 'credit') {
    const decision = await checkCredit({ customerId, orderTotal: grandTotal });
    if (decision.decision === 'blocked') {
      throw new ApiError(decision.reason || 'This customer cannot be sold to on credit', 400);
    }
    if (decision.decision === 'needsApproval' && !overrideCredit) {
      return { needsApproval: true, shortfall: decision.shortfall, exposure: decision.exposure, available: decision.available };
    }
    if (decision.decision === 'needsApproval' && overrideCredit) creditFlag = true;
  }

  const order = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { organizationId_key: { organizationId: session.user.organizationId, key: 'order' } },
      update: { seq: { increment: 1 } }, create: { key: 'order', seq: 1 },
    });
    const orderNumber = `ORD-${String(counter.seq).padStart(6, '0')}`;

    const created = await tx.order.create({
      data: {
        branchId, customerId, orderNumber, subtotal, discount: roundedDiscount, transportFee: totalTransportFee, labourFee: totalLabourFee, otherFee: totalOtherFee, grandTotal, paymentMethod, channel: effectiveChannel, createdBy: session.user.id,
        lines: {
          create: priced.map((p) => ({
            productId: p.productId, priceRuleId: p.priceRuleId, qty: p.qty, unitPrice: p.unitPrice, lineTotal: p.lineTotal, allocationId: p.allocationId, transportFee: p.transportFee,
            costs: { create: p.costs.map((c) => ({ type: c.type, amount: c.amount, detail: c.detail })) },
          })),
        },
      },
      include: { lines: true },
    });

    for (const p of priced) {
      await applyLineStock(tx, { branchId, p, reason: stockReason, ref: created.id, userId: session.user.id, defaultChannel: channel });
    }

    if (customerId && paymentMethod === 'credit') {
      await tx.customer.update({ where: { id: customerId }, data: { balance: { increment: grandTotal } } });
    }

    if (creditFlag) {
      await tx.flag.create({
        data: {
          branchId, targetType: 'Order', targetId: created.id, severity: 'concern', classification: 'concern',
          reason: `Credit sale ${created.orderNumber} overrode the customer's credit limit`, raisedBy: session.user.id,
        },
      });
    }

    // Optional same-transaction side effect (e.g. the fuel pack bumping MeterReading.creditLitres so
    // a mid-shift credit fill isn't double-counted in the shift-close aggregate cash sale).
    if (onOrderCreated) await onOrderCreated(tx, created);

    return created;
  }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default

  return { order, flagged: creditFlag };
}

// Self-service portal orders (app/api/portal/shop/orders) don't touch stock or a customer's balance
// at creation — they sit `pending` until staff confirms them (see confirmPendingOrder below), same
// spirit as a walk-in order needing a cashier vs. a customer typing their own cart into existence
// unsupervised. Still prices every line now (using this customer's own negotiated rates where set —
// see priceLines) so the customer sees a real total, not an estimate — including their standing
// transportRate (Customer, set by owner/manager), so what they see in the Shop cart before placing
// the order already matches what confirming it will charge.
export async function createPendingOrder({ session, branchId, customerId, lines, channel }) {
  if (!branchId) throw new ApiError('branchId is required', 400);
  if (!customerId) throw new ApiError('customerId is required', 400);
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError('Add at least one product', 400);
  await assertCustomerAccessible(branchId, customerId);

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { transportRate: true } });
  const { priced, subtotal } = await priceLines(lines, customerId);
  const transportFee = customer?.transportRate || 0;
  const grandTotal = subtotal + transportFee;

  const order = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { organizationId_key: { organizationId: session.user.organizationId, key: 'order' } },
      update: { seq: { increment: 1 } }, create: { key: 'order', seq: 1 },
    });
    const orderNumber = `ORD-${String(counter.seq).padStart(6, '0')}`;

    return tx.order.create({
      data: {
        branchId, customerId, orderNumber, subtotal, transportFee, grandTotal, status: 'pending', paymentMethod: 'credit', channel, createdBy: session.user.id,
        lines: { create: priced.map((p) => ({ productId: p.productId, priceRuleId: p.priceRuleId, qty: p.qty, unitPrice: p.unitPrice, lineTotal: p.lineTotal, allocationId: p.allocationId })) },
      },
      include: { lines: true },
    });
  }, { timeout: 15000 });

  return { order };
}

// Staff confirming a pending self-service order: runs the same credit check + stock/balance effects
// createSaleOrder applies at creation for a staff-recorded sale, just deferred to now. Re-resolves
// each line's price rather than trusting the pending order's stored price, in case it's stale by the
// time staff act on it (core-algorithms skill §1 — price is never trusted from an old row) — same
// re-resolution now applies to the customer's transportRate, in case that changed since they placed
// it too. Keeps each line's original allocationId (if any) so it still draws from the same batch it
// was placed against, re-validated fresh against however much is left on it now.
export async function confirmPendingOrder({ session, orderId, overrideCredit }) {
  const existing = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!existing) throw new ApiError('Order not found', 404);
  if (existing.status !== 'pending') throw new ApiError('This order is not pending', 400);
  if (!existing.customerId) throw new ApiError('Pending order has no customer', 400);

  const customer = await prisma.customer.findUnique({ where: { id: existing.customerId }, select: { transportRate: true } });
  const { priced, subtotal } = await priceLines(existing.lines.map((l) => ({ productId: l.productId, qty: l.qty, allocationId: l.allocationId })), existing.customerId);
  const transportFee = customer?.transportRate || 0;
  const grandTotal = subtotal + transportFee;
  const effectiveChannel = priced.some((p) => p.allocationId) ? 'atc' : existing.channel;

  const decision = await checkCredit({ customerId: existing.customerId, orderTotal: grandTotal });
  if (decision.decision === 'blocked') {
    throw new ApiError(decision.reason || 'This customer cannot be sold to on credit', 400);
  }
  if (decision.decision === 'needsApproval' && !overrideCredit) {
    return { needsApproval: true, shortfall: decision.shortfall, exposure: decision.exposure, available: decision.available };
  }
  const creditFlag = decision.decision === 'needsApproval' && overrideCredit;

  const order = await prisma.$transaction(async (tx) => {
    await tx.orderLine.deleteMany({ where: { orderId } });
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'active', subtotal, transportFee, grandTotal, channel: effectiveChannel,
        lines: { create: priced.map((p) => ({ productId: p.productId, priceRuleId: p.priceRuleId, qty: p.qty, unitPrice: p.unitPrice, lineTotal: p.lineTotal, allocationId: p.allocationId })) },
      },
      include: { lines: true },
    });

    for (const p of priced) {
      await applyLineStock(tx, { branchId: existing.branchId, p, reason: 'sale', ref: updated.id, userId: session.user.id, defaultChannel: existing.channel });
    }

    await tx.customer.update({ where: { id: existing.customerId }, data: { balance: { increment: grandTotal } } });

    if (creditFlag) {
      await tx.flag.create({
        data: {
          branchId: existing.branchId, targetType: 'Order', targetId: updated.id, severity: 'concern', classification: 'concern',
          reason: `Online order ${updated.orderNumber} overrode the customer's credit limit`, raisedBy: session.user.id,
        },
      });
    }

    return updated;
  }, { timeout: 15000 });

  return { order, flagged: creditFlag };
}

// Staff rejecting a pending self-service order — no stock/credit was ever applied, so this only
// needs a status flip (reuses the existing void state, same as any other cancelled order).
export async function rejectPendingOrder(orderId) {
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing) throw new ApiError('Order not found', 404);
  if (existing.status !== 'pending') throw new ApiError('This order is not pending', 400);
  return prisma.order.update({ where: { id: orderId }, data: { status: 'void' } });
}
