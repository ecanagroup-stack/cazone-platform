import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Generic across both packs — one order-based summary rather than a per-vertical report. Grouped by
// day, payment method and channel (lib/sale.js's channel tag) so a mixed fuel+shop org still gets a
// meaningful breakdown from one table. Pass serviceId instead of branchId to roll every branch of
// that service into one report — each bucket then also carries a branch name to tell them apart.
export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const serviceId = url.searchParams.get('serviceId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId && !serviceId) throw new ApiError('branchId or serviceId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);

    const branchWhere = branchId ? { id: branchId } : { serviceId };
    const branches = await prisma.branch.findMany({ where: branchWhere, select: { id: true, name: true } });
    const branchNameById = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    const allBranches = !branchId;

    const orders = await prisma.order.findMany({
      where: { branchId: { in: branches.map((b) => b.id) }, status: 'active', createdAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } },
      select: { branchId: true, createdAt: true, grandTotal: true, paymentMethod: true, channel: true },
    });

    const buckets = new Map();
    for (const o of orders) {
      const date = o.createdAt.toISOString().slice(0, 10);
      const key = `${date}|${o.branchId}|${o.paymentMethod || 'unspecified'}|${o.channel || 'unspecified'}`;
      const bucket = buckets.get(key) || {
        date, branch: branchNameById[o.branchId] || '—', paymentMethod: o.paymentMethod || 'unspecified', channel: o.channel || 'unspecified', count: 0, total: 0,
      };
      bucket.count += 1;
      bucket.total += o.grandTotal;
      buckets.set(key, bucket);
    }

    const rows = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch));
    return NextResponse.json({ success: true, data: rows, allBranches });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
