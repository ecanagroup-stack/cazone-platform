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
// rule, not one per pack. Every call logs a PriceHistory row.
//
// A non-owner CHANGING an already-priced product's price doesn't apply immediately — it lands as a
// `pending` PriceHistory row for an owner to approve (app/api/admin/pricing) and the live PriceRule
// is untouched until then. A brand-new product's first price always applies immediately regardless
// of role (nothing live to protect yet), and an owner's own change always applies immediately too.
// Returns { rule, pending } — `rule` is the (possibly still-old) current rule when pending.
export async function setPrice(tx, productId, newPrice, actor) {
  const current = await tx.priceRule.findFirst({ where: { productId, validTo: null }, orderBy: { validFrom: 'desc' } });
  if (current && current.price === newPrice) return { rule: current, pending: false };

  const requiresApproval = !!current && actor.role !== 'owner';
  if (requiresApproval) {
    await tx.priceHistory.create({
      data: { productId, oldPrice: current.price, newPrice, changedBy: actor.id, status: 'pending' },
    });
    return { rule: current, pending: true };
  }

  if (current) await tx.priceRule.update({ where: { id: current.id }, data: { validTo: new Date() } });
  const rule = await tx.priceRule.create({ data: { productId, price: newPrice, createdBy: actor.id } });
  await tx.priceHistory.create({
    data: { productId, oldPrice: current?.price ?? null, newPrice, changedBy: actor.id, status: 'approved', approvedBy: actor.id, approvedAt: new Date() },
  });
  return { rule, pending: false };
}
