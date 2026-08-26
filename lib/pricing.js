import prisma from './prisma';
import { ApiError } from './apiError';

// core-algorithms skill §1: price is a function of product, customer and quantity — never a single
// field on the product. Implements two tiers so far — customer-specific > list price; quantity-band
// tiers still slot in here later without callers changing. Every price change closes the old rule
// (validTo = now) and opens a new one — a row is never mutated, so a historic order always reprices
// identically.
export async function resolvePrice(productId, customerId) {
  if (customerId) {
    const customerRule = await prisma.priceRule.findFirst({
      where: { productId, customerId, validTo: null },
      orderBy: { validFrom: 'desc' },
    });
    if (customerRule) return { price: customerRule.price, priceRuleId: customerRule.id };
  }
  const rule = await prisma.priceRule.findFirst({
    where: { productId, customerId: null, validTo: null },
    orderBy: { validFrom: 'desc' },
  });
  if (!rule) throw new ApiError('No price is set for this product', 400);
  return { price: rule.price, priceRuleId: rule.id };
}

// A negotiated per-customer price for one product — e.g. a construction-material customer who always
// pays a set rate per bag/tonne, so their own self-service Shop orders (lib/sale.js) reflect it
// without staff involvement. Deliberately no approval gate (unlike setPrice below): owner and manager
// set this directly, since it's a relationship with one customer, not a change to the org's live
// catalog price everyone else sees. Passing `newPrice: null` clears it, reverting to list price.
export async function setCustomerPrice(productId, customerId, newPrice, actorId) {
  const current = await prisma.priceRule.findFirst({ where: { productId, customerId, validTo: null } });
  if (current) await prisma.priceRule.update({ where: { id: current.id }, data: { validTo: new Date() } });
  if (newPrice == null) return null;
  return prisma.priceRule.create({ data: { productId, customerId, price: newPrice, createdBy: actorId } });
}

// Closes the current open-ended rule (if the price actually changed) and opens a new one. Called
// from both packs' "set/confirm price" flows so there is one implementation of the effective-dated
// rule, not one per pack. Every call logs a PriceHistory row. `reason` is optional free text (the
// Cement Brands/Stonedust "Price" modals, ported from ecana_shop-app, capture one).
//
// A non-owner CHANGING an already-priced product's price doesn't apply immediately — it lands as a
// `pending` PriceHistory row for an owner to approve (app/api/admin/pricing) and the live PriceRule
// is untouched until then. A brand-new product's first price always applies immediately regardless
// of role (nothing live to protect yet), and an owner's own change always applies immediately too.
// Returns { rule, pending } — `rule` is the (possibly still-old) current rule when pending.
export async function setPrice(tx, productId, newPrice, actor, reason) {
  const current = await tx.priceRule.findFirst({ where: { productId, validTo: null }, orderBy: { validFrom: 'desc' } });
  if (current && current.price === newPrice) return { rule: current, pending: false };

  const requiresApproval = !!current && actor.role !== 'owner';
  if (requiresApproval) {
    await tx.priceHistory.create({
      data: { productId, oldPrice: current.price, newPrice, changedBy: actor.id, status: 'pending', reason: reason || null },
    });
    return { rule: current, pending: true };
  }

  if (current) await tx.priceRule.update({ where: { id: current.id }, data: { validTo: new Date() } });
  const rule = await tx.priceRule.create({ data: { productId, price: newPrice, createdBy: actor.id } });
  await tx.priceHistory.create({
    data: { productId, oldPrice: current?.price ?? null, newPrice, changedBy: actor.id, status: 'approved', approvedBy: actor.id, approvedAt: new Date(), reason: reason || null },
  });
  return { rule, pending: false };
}
