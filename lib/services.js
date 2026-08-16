import prisma from './prisma';

// DB-backed catalog of verticals an organization can subscribe to — ServiceCatalog is not in
// TENANT_SCOPED_MODELS (lib/prisma.js), so these run fine with no ambient tenant scope. Adding a
// new vertical is a row in /platform/services, not a code change; building the actual pack (schema
// + screens) is still separate engineering.
export async function getServiceCatalog({ availableOnly = false } = {}) {
  return prisma.serviceCatalog.findMany({
    where: availableOnly ? { status: 'available' } : undefined,
    orderBy: { sortOrder: 'asc' },
  });
}

export async function getServiceCatalogEntry(key) {
  if (!key) return null;
  return prisma.serviceCatalog.findUnique({ where: { key } });
}

// A service can only be newly chosen (signup, "add another service") while `available`. Existing
// Services referencing a since-`retired` key still work — this only gates NEW selection.
export async function isValidServiceType(type) {
  const entry = await getServiceCatalogEntry(type);
  return !!entry && entry.status === 'available';
}

export async function serviceLabel(type) {
  const entry = await getServiceCatalogEntry(type);
  return entry?.name || type;
}
