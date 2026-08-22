import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';

// Ported from ecana_shop-app's reports/balances — a portfolio-wide view across every customer
// (Customer has no branchId; it's an org-level account shared across branches/services, see
// prisma/schema.prisma), so unlike the other report routes this ignores branchId/serviceId scoping
// entirely. Totals split debt (negative-balance equivalent — cazone's balance sign is the opposite of
// ecana's, positive = owed) from credit-in-hand, plus a monthly debt-added-vs-payments-received trend
// computed from Order/Payment activity (there's no historical balance snapshot to replay).
export const GET = withOrg(async (request) => {
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const customers = await prisma.customer.findMany({ where: { isActive: true }, orderBy: { balance: 'desc' } });

  const totals = customers.reduce(
    (acc, c) => {
      if (c.balance > 0) { acc.totalOwed += c.balance; acc.owingCount++; }
      else if (c.balance < 0) { acc.totalCredit += -c.balance; acc.creditCount++; }
      else acc.zeroCount++;
      return acc;
    },
    { totalOwed: 0, totalCredit: 0, owingCount: 0, creditCount: 0, zeroCount: 0 }
  );
  totals.net = totals.totalOwed - totals.totalCredit;

  const dateRange = from && to ? { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } : undefined;

  const [orders, payments, adjustments] = await Promise.all([
    prisma.order.findMany({ where: { status: 'active', paymentMethod: 'credit', channel: { not: 'shop' }, ...(dateRange ? { createdAt: dateRange } : {}) }, select: { createdAt: true, grandTotal: true } }),
    prisma.payment.findMany({ where: dateRange ? { createdAt: dateRange } : {}, select: { createdAt: true, amount: true } }),
    prisma.customerAdjustment.findMany({ where: dateRange ? { createdAt: dateRange } : {}, select: { createdAt: true, type: true, amount: true } }),
  ]);

  const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
  const monthMap = new Map();
  const bump = (key, field, amount) => {
    if (!monthMap.has(key)) monthMap.set(key, { month: key, debtAdded: 0, paymentsReceived: 0 });
    monthMap.get(key)[field] += amount;
  };
  for (const o of orders) bump(monthKey(o.createdAt), 'debtAdded', o.grandTotal);
  for (const p of payments) bump(monthKey(p.createdAt), 'paymentsReceived', p.amount);
  for (const a of adjustments) bump(monthKey(a.createdAt), a.type === 'surcharge' ? 'debtAdded' : 'paymentsReceived', a.amount);

  const monthly = [...monthMap.values()].map((m) => ({ ...m, net: m.debtAdded - m.paymentsReceived })).sort((a, b) => b.month.localeCompare(a.month));

  return NextResponse.json({ success: true, data: { customers, totals, monthly } });
});
