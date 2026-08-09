import prisma from './prisma';
import { ApiError } from './apiError';

// core-algorithms skill §1: price is a function of product, customer and quantity — never a single
// field on the product. v1 only implements the last tier (list price = the product's current
// open-ended PriceRule); customer/quantity-band tiers slot in here later without callers changing.
// Every price change closes the old rule (validTo = now) and opens a new one — a row is never
// mutated, so a historic order always reprices identically.
export async function resolvePrice(productId) {
  const rule = await prisma.priceRule.findFirst({
    where: { productId, validTo: null },
    orderBy: { validFrom: 'desc' },
  });
  if (!rule) throw new ApiError('No price is set for this product', 400);
  return { price: rule.price, priceRuleId: rule.id };
}

// Closes the current open-ended rule (if the price actually changed) and opens a new one. Called
// from both packs' "set/confirm price" flows so there is one implementation of the effective-dated
// rule, not one per pack.
export async function setPrice(tx, productId, newPrice, createdBy) {
  const current = await tx.priceRule.findFirst({ where: { productId, validTo: null }, orderBy: { validFrom: 'desc' } });
  if (current && current.price === newPrice) return current;
  if (current) await tx.priceRule.update({ where: { id: current.id }, data: { validTo: new Date() } });
  return tx.priceRule.create({ data: { productId, price: newPrice, createdBy } });
}
