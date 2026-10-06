import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// One row per transaction, with the stored order and line details used by the report and CSV.
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

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        lines: { include: {
          product: { select: { name: true, attributes: true, supplier: { select: { name: true } } } },
          allocation: { include: { vehicle: { select: { plateNumber: true, driverName: true } }, supplier: { select: { name: true } } } },
        } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders.map((order) => ({
      id: order.id,
      date: order.createdAt.toISOString().slice(0, 10),
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
    }));
    return NextResponse.json({ success: true, data: rows, allBranches });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
