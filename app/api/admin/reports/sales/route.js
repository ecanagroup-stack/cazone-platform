import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { can } from '@/lib/permissions';
import { canAccessBranch, getAccessibleBranchIds } from '@/lib/branchAccess';

// One row per transaction, with the stored order and line details used by the report and CSV.
export const GET = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const serviceId = url.searchParams.get('serviceId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId && !serviceId) throw new ApiError('branchId or serviceId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);

    const branchWhere = branchId ? { id: branchId } : { serviceId };
    const branches = await prisma.branch.findMany({ where: branchWhere, select: { id: true, name: true, service: { select: { type: true } } } });
    const branchNameById = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    const allBranches = !branchId;
    const where = { branchId: { in: branches.map((b) => b.id) }, status: 'active', createdAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } };

    if (branches[0]?.service?.type === 'fuel_station') {
      const fuelOrders = await prisma.order.findMany({ where, select: { branchId: true, createdAt: true, grandTotal: true, paymentMethod: true, channel: true } });
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

    const accessible = await getAccessibleBranchIds(session);
    const deliveryEnabled = branches[0]?.service?.type === 'shop';
    if (deliveryEnabled) {
      const range = { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) };
      delete where.createdAt;
      where.OR = [{ saleDate: range }, { saleDate: null, createdAt: range }];
    }
    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        lines: { include: {
          costs: true,
          product: { select: { name: true, unit: true, attributes: true, supplier: { select: { name: true } } } },
          allocation: { include: { vehicle: { select: { plateNumber: true, driverName: true } }, supplier: { select: { name: true } } } },
        } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders.map((order) => ({
      id: order.id,
      date: (deliveryEnabled && order.saleDate ? order.saleDate : order.createdAt).toISOString().slice(0, 10),
      enteredAt: order.createdAt,
      branch: branchNameById[order.branchId] || '—',
      customer: order.customer?.name || 'Walk-in',
      products: order.lines.map((line) => line.product.name).join(', '),
      truck: [...new Set(order.lines.map((line) => line.sourceTruckNumber || line.allocation?.vehicle?.plateNumber).filter(Boolean))].join(', ') || '—',
      driver: [...new Set(order.lines.map((line) => line.sourceDriverName || line.allocation?.vehicle?.driverName).filter(Boolean))].join(', ') || '—',
      source: [...new Set(order.lines.map((line) => line.sourceName || line.allocation?.supplier?.name || line.product.supplier?.name).filter(Boolean))].join(', ') || '—',
      quality: [...new Set(order.lines.map((line) => line.quality || line.product.attributes?.grade || line.product.attributes?.size).filter(Boolean))].join(', ') || '—',
      salesAmount: order.subtotal - order.discount,
      transportAmount: order.transportFee,
      total: order.grandTotal,
      reference: order.orderNumber,
      paymentMethod: order.paymentMethod || 'unspecified',
      channel: order.channel || 'unspecified',
      count: 1,
      ...(deliveryEnabled ? {
        deliveryStatus: order.deliveryStatus,
        deliveryDate: order.deliveryDate?.toISOString().slice(0, 10) || order.deliveredAt?.toISOString().slice(0, 10) || null,
        editable: order.deliveryStatus === 'pending' && can(session?.user?.role, 'sales.record') && canAccessBranch(accessible, order.branchId) && order.lines.every((line) => line.stockQty != null),
        edit: order.deliveryStatus === 'pending' ? {
          revision: order.deliveryRevision,
          saleDate: (order.saleDate || order.createdAt).toISOString().slice(0, 10),
          discount: order.discount,
          orderTransportFee: order.transportFee - order.lines.reduce((sum, line) => sum + line.transportFee, 0),
          lines: order.lines.map((line) => ({
            id: line.id, product: line.product.name, unit: line.product.unit, qty: line.qty, stockQty: line.stockQty,
            unitPrice: line.unitPrice, transportFee: line.transportFee,
            costs: line.costs.map((cost) => ({ id: cost.id, type: cost.type, detail: cost.detail, amount: cost.amount })),
          })),
        } : null,
      } : {}),
    }));
    if (deliveryEnabled) rows.sort((left, right) => right.date.localeCompare(left.date) || new Date(right.enteredAt) - new Date(left.enteredAt));
    return NextResponse.json({ success: true, data: rows, allBranches, deliveryEnabled });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
