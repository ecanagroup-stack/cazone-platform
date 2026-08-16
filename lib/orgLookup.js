import { cache } from 'react';
import prisma from './prisma';

// Wrapped in React's cache() so generateMetadata (favicon) and the layout body (header/branding)
// can each ask for the same org within one request without a duplicate query — Organization isn't
// tenant-scoped (it IS the tenant), so this is a plain lookup either way.
export const getCachedOrganization = cache(async (orgId) => {
  return prisma.organization.findUnique({ where: { id: orgId } });
});
