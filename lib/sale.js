import prisma from './prisma';
import { resolvePrice } from './pricing';
import { checkCredit } from './credit';
import { ApiError } from './apiError';

async function priceLines(lines) {
  const priced = [];
  let subtotal = 0;
  for (const line of lines) {
    const qty = Number(line.qty);
    if (!line.productId || !Number.isFinite(qty) || qty <= 0) throw new ApiError('Every line needs a product and a positive quantity', 400);
    const { price, priceRuleId } = await resolvePrice(line.productId);
    const lineTotal = Math.round(qty * price);
    subtotal += lineTotal;
    priced.push({ productId: line.productId, qty, unitPrice: price, lineTotal, priceRuleId, allocationId: line.allocationId || null });
  }
  return { priced, subtotal };
}

// Applies one priced line's stock effect inside an open transaction. A line referencing a supply
// allocation (lib/allocation.js) draws down Delivery.qtyRemaining instead of creating an ordinary
// purchase-backed stock move — that batch was never received into general stock, so there's nothing
// to decrement there; it's consumed directly, same as the old ATC app. Auto-closes the allocation at
// zero. Returns the channel this line's StockMove should carry ('atc' when allocation-sourced,
// otherwise the order's own channel).
async function applyLineStock(tx, { branchId, p, reason, ref, userId, defaultChannel }) {
  let channel = defaultChannel;
  if (p.allocationId) {
    channel = 'atc';
    const allocation = await tx.delivery.findUnique({ where: { id: p.allocationId } });
    if (!allocation || allocation.qtyRemaining == null) throw new ApiError('Allocation not found', 400);
    if (!['loaded', 'arrived'].includes(allocation.status)) throw new ApiError('This allocation is not yet available to sell from', 400);
    if (p.qty > allocation.qtyRemaining) throw new ApiError(`Only ${allocation.qtyRemaining} remaining on this allocation`, 400);
    const remaining = allocation.qtyRemaining - p.qty;
    await tx.delivery.update({ where: { id: p.allocationId }, data: { qtyRemaining: remaining, status: remaining === 0 ? 'closed' : allocation.status } });
  }
  await tx.stockMove.create({ data: { branchId, productId: p.productId, qty: -p.qty, reason, ref, userId, channel } });
  return channel;
}

// Shared sale-creation transaction: prices each line, runs a credit check for credit sales (never
// hard-blocks — returns needsApproval so the caller's route can surface the shortfall to the user),
// then creates the Order/OrderLines, one StockMove per line, updates the customer's balance for
// credit sales, and raises a Flag if a credit shortfall was overridden. Originally the materials
// counter's checkout; the fuel pack's credit-fill action reuses it rather than reimplementing
// pricing/credit/stock — the only per-pack difference is which branch/product/customer gets passed in.
export async function createSaleOrder({ session, branchId, customerId, paymentMethod, lines, overrideCredit, stockReason = 'sale', channel, onOrderCreated }) {
  if (!branchId) throw new ApiError('branchId is required', 400);
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError('Add at least one product', 400);
  if (paymentMethod === 'credit' && !customerId) throw new ApiError('A customer is required for a credit sale', 400);

  const { priced, subtotal } = await priceLines(lines);
  const grandTotal = subtotal;
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
        branchId, customerId, orderNumber, subtotal, grandTotal, paymentMethod, channel: effectiveChannel, createdBy: session.user.id,
        lines: { create: priced.map((p) => ({ productId: p.productId, priceRuleId: p.priceRuleId, qty: p.qty, unitPrice: p.unitPrice, lineTotal: p.lineTotal, allocationId: p.allocationId })) },
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
// unsupervised. Still prices every line now so the customer sees a real total, not an estimate.
export async function createPendingOrder({ session, branchId, customerId, lines, channel }) {
  if (!branchId) throw new ApiError('branchId is required', 400);
  if (!customerId) throw new ApiError('customerId is required', 400);
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError('Add at least one product', 400);

  const { priced, subtotal } = await priceLines(lines);
  const grandTotal = subtotal;

  const order = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { organizationId_key: { organizationId: session.user.organizationId, key: 'order' } },
      update: { seq: { increment: 1 } }, create: { key: 'order', seq: 1 },
    });
    const orderNumber = `ORD-${String(counter.seq).padStart(6, '0')}`;

    return tx.order.create({
      data: {
        branchId, customerId, orderNumber, subtotal, grandTotal, status: 'pending', paymentMethod: 'credit', channel, createdBy: session.user.id,
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
// time staff act on it (core-algorithms skill §1 — price is never trusted from an old row). Keeps
// each line's original allocationId (if any) so it still draws from the same batch it was placed
// against, re-validated fresh against however much is left on it now.
export async function confirmPendingOrder({ session, orderId, overrideCredit }) {
  const existing = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!existing) throw new ApiError('Order not found', 404);
  if (existing.status !== 'pending') throw new ApiError('This order is not pending', 400);
  if (!existing.customerId) throw new ApiError('Pending order has no customer', 400);

  const { priced, subtotal } = await priceLines(existing.lines.map((l) => ({ productId: l.productId, qty: l.qty, allocationId: l.allocationId })));
  const grandTotal = subtotal;
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
        status: 'active', subtotal, grandTotal, channel: effectiveChannel,
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
