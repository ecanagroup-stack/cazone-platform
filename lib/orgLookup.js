import { cache } from 'react';
import prisma from './prisma';
import { orgHasCustomers, orgHasOrdering } from './customerAccess.mjs';

// Wrapped in React's cache() so generateMetadata (favicon) and the layout body (header/branding)
// can each ask for the same org within one request without a duplicate query — Organization isn't
// tenant-scoped (it IS the tenant), so this is a plain lookup either way.
export const getCachedOrganization = cache(async (orgId) => {
  return prisma.organization.findUnique({ where: { id: orgId } });
});

// Customer-scope flags for an org (see lib/customerAccess.mjs). Read live each request, never in the
// JWT, so adding or lapsing the distributor add-on takes effect without a re-login. BusinessAddon is
// NOT tenant-scoped, so the organizationId filter here is the only thing keeping orgs apart.
export async function loadOrgCustomerFlags(orgId) {
  const [org, addons] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { businessType: true } }),
    prisma.businessAddon.findMany({
      where: { organizationId: orgId, type: 'distributor', status: 'active' },
      select: { type: true, status: true, endsAt: true },
    }),
  ]);
  const businessType = org?.businessType || null;
  return {
    businessType,
    hasCustomers: orgHasCustomers({ businessType, addons }),
    hasOrdering: orgHasOrdering({ businessType }),
  };
}

// Cached per render so a layout and its page share one lookup; route handlers call the uncached form.
export const getOrgCustomerFlags = cache(loadOrgCustomerFlags);
