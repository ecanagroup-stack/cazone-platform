import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

const DAY_MS = 24 * 60 * 60 * 1000;

// Ageing buckets computed live from Order.createdAt (no due-date concept yet — see plan). Only
// credit orders with an outstanding balance count; cash/pos/transfer sales never age.
function ageBucket(daysOld) {
  if (daysOld <= 30) return 'current';
  if (daysOld <= 60) return 'd1_30';
  if (daysOld <= 90) return 'd31_60';
  if (daysOld <= 120) return 'd61_90';
  return 'd90_plus';
}

export const GET = withOrg(async (request, { params }) => {
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new ApiError('Customer not found', 404);

    const [orders, payments, adjustments] = await Promise.all([
      prisma.order.findMany({ where: { customerId: id }, include: { lines: true, allocations: true }, orderBy: { createdAt: 'asc' } }),
      prisma.payment.findMany({ where: { customerId: id }, include: { allocations: true }, orderBy: { createdAt: 'asc' } }),
      prisma.customerAdjustment.findMany({ where: { customerId: id }, orderBy: { createdAt: 'asc' } }),
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
      ...orders.map((o) => ({ type: 'order', id: o.id, date: o.createdAt, label: o.orderNumber, amount: o.grandTotal, method: o.paymentMethod })),
      ...payments.map((p) => ({ type: 'payment', id: p.id, date: p.createdAt, label: `Payment (${p.method})`, amount: -p.amount, reference: p.reference })),
      ...adjustments.map((a) => ({ type: 'adjustment', id: a.id, date: a.createdAt, label: `${a.type === 'refund' ? 'Refund' : 'Surcharge'}: ${a.reason || ''}`, amount: a.type === 'refund' ? -a.amount : a.amount })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = 0;
    for (const entry of ledger) { running += entry.amount; entry.runningBalance = running; }

    return NextResponse.json({ success: true, data: { customer, ledger: ledger.reverse(), buckets } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to edit customers' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.phone === 'string') update.phone = body.phone.trim() || null;
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.onHold === 'boolean') update.onHold = body.onHold;
    if (body.creditLimit !== undefined) {
      const n = Math.round(Number(body.creditLimit));
      if (!Number.isFinite(n) || n < 0) throw new ApiError('Invalid credit limit', 400);
      update.creditLimit = n;
    }

    const before = await prisma.customer.findUnique({ where: { id } });
    if (!before) throw new ApiError('Customer not found', 404);
    const updated = await prisma.customer.update({ where: { id }, data: update });

    if (update.creditLimit !== undefined || update.onHold !== undefined) {
      await logAudit({
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'customer.updated', entityType: 'Customer', entityId: id,
        before: { creditLimit: before.creditLimit, onHold: before.onHold },
        after: { creditLimit: updated.creditLimit, onHold: updated.onHold },
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
