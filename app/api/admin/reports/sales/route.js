import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { can, REPORT_ROLES } from '@/lib/permissions';
import { canAccessBranch, getAccessibleBranchIds } from '@/lib/branchAccess';
import { dateRangeWhere } from '@/lib/businessDates.mjs';
import { salesReportRow } from '@/lib/salesReportRows.mjs';

// One row per transaction, with its line items (lib/salesReportRows.mjs) for the report, sale detail and CSV.
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

    const branchWhere = branchId ? { id: branchId } : { serviceId };
    const accessible = await getAccessibleBranchIds(session);
    const branches = (await prisma.branch.findMany({ where: branchWhere, select: { id: true, name: true, service: { select: { type: true } } } }))
      .filter((b) => canAccessBranch(accessible, b.id));
    const branchNameById = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    const allBranches = !branchId;
    const where = { branchId: { in: branches.map((b) => b.id) }, status: 'active' };

    if (branches[0]?.service?.type === 'fuel_station') {
      const fuelOrders = await prisma.order.findMany({ where: { ...where, createdAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } }, select: { branchId: true, createdAt: true, grandTotal: true, paymentMethod: true, channel: true } });
      const buckets = new Map();
      for (const order of fuelOrders) {
        const date = order.createdAt.toISOString().slice(0, 10);
        const key = `${date}|${order.branchId}|${order.paymentMethod || 'unspecified'}|${order.channel || 'unspecified'}`;
        const bucket = buckets.get(key) || { date, branch: branchNameById[order.branchId] || '—', paymentMethod: order.paymentMethod || 'unspecified', channel: order.channel || 'unspecified', count: 0, total: 0 };
        bucket.count += 1;
        bucket.total += order.grandTotal;
        buckets.set(key, bucket);
      }
      const rows = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch));
      return NextResponse.json({ success: true, data: rows, allBranches, fuelSummary: true });
    }

    const deliveryEnabled = branches[0]?.service?.type === 'shop';
    const orders = await prisma.order.findMany({
      where: { ...where, ...dateRangeWhere('saleDate', { from, to }) },
      include: {
        customer: { select: { name: true } },
        lines: { include: {
          costs: true,
          product: { select: { name: true, unit: true, supplier: { select: { name: true } } } },
          allocation: { include: { product: { select: { abbreviation: true } }, vehicle: { select: { plateNumber: true, driverName: true } }, supplier: { select: { name: true } } } },
        } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const canEdit = (order) => can(session?.user?.role, 'sales.record') && canAccessBranch(accessible, order.branchId);
    const rows = orders.map((order) => salesReportRow(order, { branchNameById, deliveryEnabled, canEdit }));
    rows.sort((left, right) => right.date.localeCompare(left.date) || new Date(right.enteredAt) - new Date(left.enteredAt));
    return NextResponse.json({ success: true, data: rows, allBranches, deliveryEnabled });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
