import prisma from './prisma';

// core-algorithms skill §4: there is no mutable quantity field anyone writes to directly. On-hand
// is always a live sum of the ledger, never a cached field.
export async function getOnHand(branchId, productId) {
  const result = await prisma.stockMove.aggregate({ where: { branchId, productId }, _sum: { qty: true } });
  return result._sum.qty || 0;
}

// Batched version for a list screen showing many products at once — one query instead of N.
export async function getOnHandByProduct(branchId, productIds) {
  if (productIds.length === 0) return {};
  const rows = await prisma.stockMove.groupBy({
    by: ['productId'], where: { branchId, productId: { in: productIds } }, _sum: { qty: true },
  });
  return Object.fromEntries(rows.map((r) => [r.productId, r._sum.qty || 0]));
}
