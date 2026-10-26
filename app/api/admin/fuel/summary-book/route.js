import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { computePeriod } from '@/lib/reconciliation';
import { ApiError } from '@/lib/apiError';
import { requireBranch } from '@/lib/branchAccess';
import { FUEL_SUMMARY_ROLES } from '@/lib/permissions';
import { summarizePumpCollection } from '@/lib/fuelCollections.mjs';

// Ported from petrol-station-app's Summary Book (lib/summaryBookRows.js) — one row per shift per
// product: opening/stock-in/sales/closing stock, price, revenue, and any shortage (sales value vs.
// cash+POS collected, plus dip-verified delivery variance). cazone's MeterReading already carries its
// own computed litres/expectedAmount/cashCollected per shift (unlike the old app's separate
// SalesEntry/PaymentRecord/DayShift joins by date string), and Reconciliation already IS the closing
// stock checkpoint, so this reuses those directly instead of re-deriving anything.
export const GET = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!FUEL_SUMMARY_ROLES.includes(session?.user?.role)) throw new ApiError('Forbidden', 403);
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!branchId) throw new ApiError('branchId is required', 400);
    if (!from || !to) throw new ApiError('from and to are required', 400);
    await requireBranch(session, branchId);

    // Tolerance is the allowed loss as a % of the litres sold (the branch's reconciliation tolerance, 0.5% unless
    // the owner set another); each row carries it in litres so the book can total it like stock in and revenue.
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { config: true } });
    const tolerancePct = Number(branch?.config?.reconciliationTolerancePct) || 0.5;

    const shifts = await prisma.shift.findMany({
      where: { branchId, operatingDate: { gte: from, lte: to } },
      orderBy: { openedAt: 'asc' },
    });
    if (shifts.length === 0) return NextResponse.json({ success: true, data: [] });

    const shiftIds = shifts.map((s) => s.id);
    const readings = await prisma.meterReading.findMany({
      where: { shiftId: { in: shiftIds } },
      include: { dispenser: { include: { tank: { include: { product: true } } } } },
    });
    const collections = await prisma.fuelCollection.findMany({ where: { shiftId: { in: shiftIds } } });
    const historicalProductIds = [...new Set(readings.map((reading) => reading.productIdAtShift).filter(Boolean))];
    const historicalProducts = await prisma.product.findMany({ where: { id: { in: historicalProductIds } } });
    const historicalProductById = Object.fromEntries(historicalProducts.map((product) => [product.id, product]));

    const rows = [];
    for (const shift of shifts) {
      const periodEnd = shift.closedAt || new Date();
      const shiftReadings = readings.filter((r) => r.shiftId === shift.id);
      const incompleteReadings = shiftReadings.filter((r) => r.reviewStatus !== 'approved' || !r.orderId).length;

      const byProduct = new Map();
      for (const r of shiftReadings) {
        if (r.reviewStatus !== 'approved' || !r.orderId) continue;
        const product = historicalProductById[r.productIdAtShift] || r.dispenser.tank?.product;
        if (!product) continue;
        const row = byProduct.get(product.id) || { product, sales: 0, amount: 0, collected: 0, salesShortage: 0, unknownCollections: 0 };
        const pump = summarizePumpCollection(r.expectedAmount, collections.filter((c) => c.meterReadingId === r.id));
        row.sales += r.litres || 0;
        row.amount += r.expectedAmount || 0;
        row.collected += pump.collected;
        if (r.collectionCoverage === 'unknown') row.unknownCollections += 1;
        else row.salesShortage += pump.outstanding;
        byProduct.set(product.id, row);
      }

      for (const [productId, agg] of byProduct) {
        const period = await computePeriod(branchId, productId, shift.openedAt, periodEnd);
        const openingDips = await prisma.fuelTankDip.findMany({
          where: { shiftId: shift.id, period: 'opening', tank: { productId } },
          select: { measured: true },
        });
        const opening = openingDips.length ? openingDips.reduce((sum, dip) => sum + dip.measured, 0) : period.opening;
        const receipts = period.receipts;
        const book = opening + receipts - period.sales;

        const closingRecon = await prisma.reconciliation.findFirst({
          where: { branchId, productId, periodEnd: { gte: shift.openedAt, lte: periodEnd } },
          orderBy: { periodEnd: 'desc' },
        });
        const recordedClosingDips = closingRecon ? [] : await prisma.fuelTankDip.findMany({
          where: { shiftId: shift.id, period: 'closing', tank: { productId } }, select: { measured: true },
        });

        const deliveries = await prisma.delivery.findMany({
          where: { branchId, productId, offloadVariance: { not: null }, createdAt: { gte: shift.openedAt, lte: periodEnd } },
        });
        const price = agg.sales > 0 ? Math.round(agg.amount / agg.sales) : 0;
        // Offload variance is in litres; report shortages in kobo alongside pump balances.
        const deliveryShortage = Math.round(deliveries.reduce((s, d) => s + Math.max(0, -d.offloadVariance), 0) * price);
        const deliveryExcess = Math.round(deliveries.reduce((s, d) => s + Math.max(0, d.offloadVariance), 0) * price);
        const salesShortage = agg.salesShortage;

        rows.push({
          date: `${shift.operatingDate}T12:00:00.000Z`, openedAt: shift.openedAt,
          shiftLabel: shift.shiftLabel, shiftOrder: shift.shiftOrder,
          product: agg.product.name, productId,
          openingStock: opening, stockIn: receipts, book, sales: agg.sales, price,
          tolerancePct, tolerance: Math.round(agg.sales * tolerancePct * 10) / 1000,
          totalAmount: agg.amount, collected: agg.collected,
          closingStock: closingRecon ? closingRecon.measured : recordedClosingDips.length
            ? recordedClosingDips.reduce((sum, dip) => sum + dip.measured, 0) : null,
          closingStockSource: closingRecon ? 'reconciliation' : recordedClosingDips.length ? 'recorded_dips' : null,
          salesShortage, deliveryShortage, deliveryExcess,
          shortage: salesShortage + deliveryShortage, unknownCollections: agg.unknownCollections,
          incompleteReadings: 0,
        });
      }
      if (incompleteReadings) rows.push({
        date: `${shift.operatingDate}T12:00:00.000Z`, openedAt: shift.openedAt,
        shiftLabel: shift.shiftLabel, shiftOrder: shift.shiftOrder,
        product: 'Unconfirmed pump readings', productId: null,
        openingStock: 0, stockIn: 0, book: null, sales: 0, price: 0, tolerancePct, tolerance: 0,
        totalAmount: 0, collected: 0, closingStock: null, closingStockSource: null,
        salesShortage: 0, deliveryShortage: 0, deliveryExcess: 0,
        shortage: 0, unknownCollections: 0, incompleteReadings,
      });
    }

    rows.sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.openedAt) - new Date(a.openedAt));
    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
