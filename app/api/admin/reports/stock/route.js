import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { REPORT_ROLES } from '@/lib/permissions';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';

// StockMove ledger grouped by product/reason for the range (what came in, what sold, what was
// adjusted), plus any Reconciliation rows in range for their measured variance — the two things the
// old fuel app's summary-book combined into one report. Pass serviceId instead of branchId to roll
// every branch of that service into one report — buckets then split by branch too.
export const GET = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!REPORT_ROLES.includes(session?.user?.role)) throw new ApiError('Forbidden', 403);
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const serviceId = url.searchParams.get('serviceId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId && !serviceId) throw new ApiError('branchId or serviceId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);

    const range = { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) };
    const branchWhere = branchId ? { id: branchId } : { serviceId };
    // Only the stations the caller handles go into the report, whether one was asked for or the whole service.
    const accessible = await getAccessibleBranchIds(session);
    if (branchId && !canAccessBranch(accessible, branchId)) throw new ApiError('You do not have access to this station', 403);
    const branches = (await prisma.branch.findMany({ where: branchWhere, select: { id: true, name: true } })).filter((b) => canAccessBranch(accessible, b.id));
    const branchNameById = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    const allBranches = !branchId;
    const branchIds = branches.map((b) => b.id);

    const [moves, reconciliations] = await Promise.all([
      prisma.stockMove.findMany({
        where: { branchId: { in: branchIds }, at: range },
        include: { product: true },
      }),
      prisma.reconciliation.findMany({
        where: { branchId: { in: branchIds }, periodEnd: range },
        include: { product: true },
        orderBy: { periodEnd: 'desc' },
      }),
    ]);

    const buckets = new Map();
    for (const m of moves) {
      const key = `${m.branchId}|${m.productId}|${m.reason}`;
      const bucket = buckets.get(key) || { branch: branchNameById[m.branchId] || '—', product: m.product.name, unit: m.product.unit, reason: m.reason, qty: 0 };
      bucket.qty += m.qty;
      buckets.set(key, bucket);
    }
    const rows = [...buckets.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.product.localeCompare(b.product) || a.reason.localeCompare(b.reason));

    const variance = reconciliations.map((r) => ({
      branch: branchNameById[r.branchId] || '—', product: r.product.name, periodEnd: r.periodEnd, book: r.book, measured: r.measured, variance: r.variance, variancePct: r.variancePct, status: r.status,
    }));

    return NextResponse.json({ success: true, data: { rows, variance }, allBranches });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
