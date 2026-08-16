import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';
import { computePeriod } from '@/lib/reconciliation';
import { ApiError } from '@/lib/apiError';

// Ported from petrol-station-app's Summary Book (lib/summaryBookRows.js) — one row per shift per
// product: opening/stock-in/sales/closing stock, price, revenue, and any shortage (sales value vs.
// cash+POS collected, plus dip-verified delivery variance). cazone's MeterReading already carries its
// own computed litres/expectedAmount/cashCollected per shift (unlike the old app's separate
// SalesEntry/PaymentRecord/DayShift joins by date string), and Reconciliation already IS the closing
// stock checkpoint, so this reuses those directly instead of re-deriving anything.
export const GET = withOrg(async (request) => {
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId) throw new ApiError('branchId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);

    const shifts = await prisma.shift.findMany({
      where: { branchId, openedAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } },
      orderBy: { openedAt: 'asc' },
    });
    if (shifts.length === 0) return NextResponse.json({ success: true, data: [] });

    const shiftIds = shifts.map((s) => s.id);
    const readings = await prisma.meterReading.findMany({
      where: { shiftId: { in: shiftIds }, reviewStatus: 'approved' },
      include: { dispenser: { include: { tank: { include: { product: true } } } }, posPayments: true },
    });

    const rows = [];
    for (const shift of shifts) {
      const periodEnd = shift.closedAt || new Date();
      const shiftReadings = readings.filter((r) => r.shiftId === shift.id);

      const byProduct = new Map();
      for (const r of shiftReadings) {
        const product = r.dispenser.tank?.product;
        if (!product) continue;
        const row = byProduct.get(product.id) || { product, sales: 0, amount: 0, collected: 0 };
        row.sales += r.litres || 0;
        row.amount += r.expectedAmount || 0;
        row.collected += (r.cashCollected || 0) + r.posPayments.reduce((s, p) => s + p.amount, 0);
        byProduct.set(product.id, row);
      }

      for (const [productId, agg] of byProduct) {
        const { opening, receipts, book } = await computePeriod(branchId, productId, shift.openedAt, periodEnd);

        const closingRecon = await prisma.reconciliation.findFirst({
          where: { branchId, productId, periodEnd: { gte: shift.openedAt, lte: periodEnd } },
          orderBy: { periodEnd: 'desc' },
        });

        const deliveries = await prisma.delivery.findMany({
          where: { branchId, productId, offloadVariance: { not: null }, createdAt: { gte: shift.openedAt, lte: periodEnd } },
        });
        const deliveryShortage = deliveries.reduce((s, d) => s + (d.offloadVariance < 0 ? -d.offloadVariance : 0), 0);
        const deliveryExcess = deliveries.reduce((s, d) => s + (d.offloadVariance > 0 ? d.offloadVariance : 0), 0);

        const price = agg.sales > 0 ? Math.round(agg.amount / agg.sales) : 0;
        const salesShortage = Math.max(0, agg.amount - agg.collected);

        rows.push({
          date: shift.openedAt, shiftLabel: shift.shiftLabel, shiftOrder: shift.shiftOrder,
          product: agg.product.name, productId,
          openingStock: opening, stockIn: receipts, book, sales: agg.sales, price,
          totalAmount: agg.amount, collected: agg.collected,
          closingStock: closingRecon ? closingRecon.measured : null,
          salesShortage, deliveryShortage, deliveryExcess,
          shortage: salesShortage + deliveryShortage,
        });
      }
    }

    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
