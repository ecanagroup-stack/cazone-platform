import prisma from './prisma';

// Same person can be typed as "Anayo Ezeh" or "Ezeh Anayo" — sorting the words after lowercasing
// makes both collapse to the same key, so word order and case don't create a false "unique" name.
// Ported from ecana_shop-app's lib/customerName.js; Customer.normalizedName stores this so the DB's
// own @@unique([organizationId, normalizedName]) constraint enforces it, not just this check.
export function normalizeCustomerName(name) {
  return (name || '').trim().toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
}

// Prisma is already tenant-scoped (lib/tenantScope.js) so this only ever sees the current org's
// customers. excludeId is the customer being edited, so renaming to the same name (or just
// re-casing/reordering it) isn't flagged as colliding with itself.
export async function findDuplicateCustomerName(name, excludeId) {
  const key = normalizeCustomerName(name);
  if (!key) return null;
  return prisma.customer.findFirst({
    where: { normalizedName: key, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
}
