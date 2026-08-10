import prisma from './prisma';

// core-algorithms skill §5 — the shared bulk-reconciliation abstraction. `getOnHand` (lib/stock.js)
// only gives a point-in-time total; this splits the ledger into the opening/receipts/sales pieces
// the formula needs: book = opening + receipts - sales, variance = measured - book.
export async function computePeriod(branchId, productId, periodStart, periodEnd) {
  const [openingAgg, periodMoves] = await Promise.all([
    prisma.stockMove.aggregate({ where: { branchId, productId, at: { lt: periodStart } }, _sum: { qty: true } }),
    prisma.stockMove.findMany({ where: { branchId, productId, at: { gte: periodStart, lte: periodEnd } } }),
  ]);

  const opening = openingAgg._sum.qty || 0;
  const receipts = periodMoves.filter((m) => m.reason === 'purchase').reduce((s, m) => s + m.qty, 0);
  const sales = periodMoves.filter((m) => m.reason === 'sale').reduce((s, m) => s + -m.qty, 0);
  const book = opening + receipts - sales;

  return { opening, receipts, sales, book };
}

export function evaluateVariance(book, measured, receipts, tolerancePct) {
  const variance = measured - book;
  const variancePct = (Math.abs(variance) / Math.max(receipts, 1)) * 100;
  const status = variancePct > tolerancePct ? 'exception' : 'within_tolerance';
  return { variance, variancePct, status };
}
