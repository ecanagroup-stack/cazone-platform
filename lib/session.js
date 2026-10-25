import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { runWithOrg } from './tenantScope';
import prisma from './prisma';
import { loadOrgCustomerFlags } from './orgLookup';

const BUSINESS_API_PREFIXES = [
  ['/api/admin/fuel/', 'fuel_station'],
  ['/api/admin/materials/', 'shop'],
  ['/api/admin/retail/', 'general_store'],
];

// Customer-facing surface: only orgs that have customers at all (lib/customerAccess.mjs) may reach it.
const CUSTOMER_API_PREFIXES = ['/api/admin/customers', '/api/admin/chat', '/api/admin/reports/balances', '/api/portal/'];
const underPrefix = (path, prefix) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`);

export { enterOrg } from './tenantScope';

export async function getOrgSession() {
  return await getServerSession(authOptions);
}

// `enabledServices` missing entirely (session predates the field, or org lookup failed) fails open
// rather than locking every org out until re-login — same tradeoff ecana_shop-app made for hasModule.
export function hasService(session, serviceType) {
  const enabled = session?.user?.enabledServices;
  if (!enabled) return true;
  return enabled.includes(serviceType);
}

// HOC: wraps a route handler so its ENTIRE body runs inside the tenant scope via runWithOrg — the
// handler keeps calling getOrgSession() itself; its Prisma queries are scoped because they execute
// inside this call. No org on the session (unauthenticated) runs the handler un-wrapped so its own
// guard returns 401 — the fail-closed Prisma extension still throws on any scoped query attempted
// regardless.
export function withOrg(handler, requiredService) {
  return async (request, context) => {
    const session = await getServerSession(authOptions);
    const orgId = session?.user?.organizationId;
    if (!orgId) return handler(request, context);
    return runWithOrg(orgId, async () => {
      const path = new URL(request.url).pathname;
      if (CUSTOMER_API_PREFIXES.some((prefix) => underPrefix(path, prefix))) {
        const { hasCustomers } = await loadOrgCustomerFlags(orgId);
        if (!hasCustomers) return NextResponse.json({ error: 'Customers are not available for this business' }, { status: 403 });
      }
      const businessForPath = BUSINESS_API_PREFIXES.find(([prefix]) => path.startsWith(prefix))?.[1];
      const isSharedSupplierApi = path === '/api/admin/suppliers' || path.startsWith('/api/admin/suppliers/');
      const isWrite = !['GET', 'HEAD'].includes(request.method);
      const org = requiredService || businessForPath || isWrite || isSharedSupplierApi
        ? await prisma.organization.findUnique({ where: { id: orgId }, select: { businessType: true } })
        : null;
      const serviceType = requiredService || businessForPath || (isSharedSupplierApi ? org?.businessType : null);
      if (isSharedSupplierApi && !['fuel_station', 'shop', 'general_store'].includes(org?.businessType)) {
        return NextResponse.json({ error: 'This business is not active for your organization' }, { status: 403 });
      }
      if (serviceType) {
        const service = org?.businessType === serviceType
          ? await prisma.service.findFirst({ where: { type: serviceType }, select: { id: true, isActive: true, config: true } })
          : null;
        if (!service || !service.isActive) return NextResponse.json({ error: 'This business is not active for your organization' }, { status: 403 });
      }
      return handler(request, context);
    });
  };
}
