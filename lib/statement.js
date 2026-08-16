import prisma from './prisma';

const DAY_MS = 24 * 60 * 60 * 1000;

// Ageing buckets computed live from Order.createdAt (no due-date concept yet). Only credit orders
// with an outstanding balance count; cash/pos/transfer sales never age.
function ageBucket(daysOld) {
  if (daysOld <= 30) return 'current';
  if (daysOld <= 60) return 'd1_30';
  if (daysOld <= 90) return 'd31_60';
  if (daysOld <= 120) return 'd61_90';
  return 'd90_plus';
}

// Shared by the admin customer detail page and the customer portal statement — same ledger, same
// ageing, the only difference is who's allowed to ask for it.
export async function buildCustomerStatement(customerId) {
  const [orders, payments, adjustments] = await Promise.all([
    // `pending` self-service orders haven't touched stock or balance yet (see lib/sale.js
    // createPendingOrder/confirmPendingOrder) — excluded here so the running balance never counts a
    // sale that hasn't actually happened.
    prisma.order.findMany({ where: { customerId, status: { not: 'pending' } }, include: { lines: true, allocations: true }, orderBy: { createdAt: 'asc' } }),
    prisma.payment.findMany({ where: { customerId }, include: { allocations: true }, orderBy: { createdAt: 'asc' } }),
    prisma.customerAdjustment.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } }),
  ]);

  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const now = Date.now();
  for (const order of orders) {
    if (order.paymentMethod !== 'credit' || order.status !== 'active') continue;
    const allocated = order.allocations.reduce((s, a) => s + a.amount, 0);
    const outstanding = order.grandTotal - allocated;
    if (outstanding <= 0) continue;
    const daysOld = Math.floor((now - new Date(order.createdAt).getTime()) / DAY_MS);
    buckets[ageBucket(daysOld)] += outstanding;
  }

  const ledger = [
    ...orders.map((o) => ({ type: 'order', id: o.id, date: o.createdAt, label: o.orderNumber, amount: o.grandTotal, method: o.paymentMethod, channel: o.channel })),
    ...payments.map((p) => ({ type: 'payment', id: p.id, date: p.createdAt, label: `Payment (${p.method})`, amount: -p.amount, reference: p.reference })),
    ...adjustments.map((a) => ({ type: 'adjustment', id: a.id, date: a.createdAt, label: `${a.type === 'refund' ? 'Refund' : 'Surcharge'}: ${a.reason || ''}`, amount: a.type === 'refund' ? -a.amount : a.amount })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  for (const entry of ledger) { running += entry.amount; entry.runningBalance = running; }

  return { ledger: ledger.reverse(), buckets };
}
