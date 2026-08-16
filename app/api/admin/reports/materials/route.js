import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Construction Material-only reports (M6) — ported from ecana_shop-app's reports/products,
// reports/trucks and reports/quarry-purchases, each collapsed into one route selected by `type`
// rather than three separate pages, matching how the generic reports/{sales,stock,cash} routes are
// already organized in this app. `type=products` splits cement (Product.abbreviation set) from
// aggregate (Product.supplierId set) from plain shop items, and reports both billed and actually
// loaded quantity — the same bill-vs-stock split every materials sale flow already carries (see
// lib/sale.js's priceLines) — by reading the offsetting sale StockMove per order line rather than
// OrderLine.qty alone (which only ever holds the billed figure).
export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'products';
    const branchId = url.searchParams.get('branchId');
    const serviceId = url.searchParams.get('serviceId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId && !serviceId) throw new ApiError('branchId or serviceId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);

    const branchWhere = branchId ? { id: branchId } : { serviceId };
    const branches = await prisma.branch.findMany({ where: branchWhere, select: { id: true } });
    const branchIds = branches.map((b) => b.id);
    const dateRange = { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) };

    if (type === 'trucks') {
      const deliveries = await prisma.delivery.findMany({
        where: { branchId: { in: branchIds }, vehicleId: { not: null }, createdAt: dateRange },
        include: { vehicle: true },
      });
      const byVehicle = new Map();
      for (const d of deliveries) {
        const key = d.vehicleId;
        const row = byVehicle.get(key) || { plateNumber: d.vehicle.plateNumber, driverName: d.vehicle.driverName || '—', trips: 0, totalCost: 0 };
        row.trips += 1;
        row.totalCost += d.totalCost;
        byVehicle.set(key, row);
      }
      const rows = [...byVehicle.values()].sort((a, b) => a.plateNumber.localeCompare(b.plateNumber));
      return NextResponse.json({ success: true, data: rows });
    }

    if (type === 'quarry-purchases') {
      const deliveries = await prisma.delivery.findMany({
        where: { branchId: { in: branchIds }, supplier: { type: 'quarry' }, createdAt: dateRange },
        include: { supplier: true, vehicle: true, product: true },
        orderBy: { createdAt: 'desc' },
      });
      const rows = deliveries.map((d) => ({
        date: d.createdAt,
        quarryName: d.supplier?.name || '—',
        product: d.product?.name || '—',
        truckPlate: d.vehicle?.plateNumber || '—',
        quantity: d.quantity,
        costPerUnit: d.costPerUnit,
        totalCost: d.totalCost,
      }));
      const totals = { quantity: rows.reduce((s, r) => s + r.quantity, 0), cost: rows.reduce((s, r) => s + r.totalCost, 0) };
      return NextResponse.json({ success: true, data: rows, totals });
    }

    // type === 'products'
    const lines = await prisma.orderLine.findMany({
      where: { order: { branchId: { in: branchIds }, status: 'active', createdAt: dateRange } },
      include: { product: true },
    });
    if (lines.length === 0) return NextResponse.json({ success: true, data: [] });

    const orderIds = [...new Set(lines.map((l) => l.orderId))];
    const saleMoves = await prisma.stockMove.findMany({
      where: { reason: 'sale', ref: { in: orderIds }, productId: { in: [...new Set(lines.map((l) => l.productId))] } },
      select: { ref: true, productId: true, qty: true },
    });
    const actualByKey = new Map();
    for (const m of saleMoves) {
      const key = `${m.ref}|${m.productId}`;
      actualByKey.set(key, (actualByKey.get(key) || 0) - m.qty); // stored negative — flip to a positive "actually loaded" figure
    }

    const byProduct = new Map();
    for (const l of lines) {
      const p = l.product;
      const category = p.abbreviation ? 'cement' : p.supplierId ? 'aggregate' : 'shop';
      const row = byProduct.get(p.id) || { productId: p.id, name: p.name, unit: p.unit, category, billQty: 0, actualQty: 0, revenue: 0 };
      row.billQty += l.qty;
      row.actualQty += actualByKey.get(`${l.orderId}|${p.id}`) ?? l.qty;
      row.revenue += l.lineTotal;
      byProduct.set(p.id, row);
    }

    const rows = [...byProduct.values()].sort((a, b) => a.category.localeCompare(b.category) || b.revenue - a.revenue);
    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
