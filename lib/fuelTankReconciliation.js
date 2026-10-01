import { evaluateVariance } from './reconciliation';
import { summarizeTankProduct } from './fuelCollections.mjs';

// Create one product-level reconciliation from the closing dip of every physical tank.
// Sales come from the submitted meter movement, including credit fills, so approval timing
// cannot make a tank appear artificially overstocked.
export async function createShiftTankReconciliations(tx, { shift, readings, tanks, openingDips, closingDips, branch, actorId, periodEnd }) {
  const tolerancePct = Number(branch?.config?.reconciliationTolerancePct) || 0.5;
  const results = [];
  for (const productId of new Set(tanks.map((tank) => tank.productId))) {
    const ledgerOpening = (await tx.stockMove.aggregate({ where: { branchId: shift.branchId, productId, at: { lt: shift.openedAt } }, _sum: { qty: true } }))._sum.qty || 0;
    const purchases = await tx.stockMove.findMany({ where: {
      branchId: shift.branchId, productId, reason: 'purchase', at: { gte: shift.openedAt, lte: periodEnd },
    } });
    const { opening, receipts, sales, book, measured } = summarizeTankProduct(productId, tanks, openingDips, closingDips, readings, purchases, ledgerOpening);
    const { variance, variancePct, status } = evaluateVariance(book, measured, receipts, tolerancePct);
    const reconciliation = await tx.reconciliation.create({ data: {
      branchId: shift.branchId, productId, periodStart: shift.openedAt, periodEnd,
      opening, receipts, sales, book, measured, variance, variancePct, tolerance: tolerancePct, status,
    } });
    if (status === 'exception') await tx.flag.create({ data: {
      branchId: shift.branchId, targetType: 'Reconciliation', targetId: reconciliation.id,
      severity: 'concern', classification: 'concern', raisedBy: actorId,
      reason: `Closing tank stock variance of ${variance.toFixed(1)}L (${variancePct.toFixed(2)}%) for product ${productId}`,
    } });
    results.push(reconciliation);
  }
  return results;
}
