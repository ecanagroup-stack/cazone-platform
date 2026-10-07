import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { runWithOrg } from './tenantScope';
import prisma from './prisma';

const BUSINESS_API_PREFIXES = [
  ['/api/admin/fuel/', 'fuel_station'],
  ['/api/admin/materials/', 'shop'],
  ['/api/admin/retail/', 'general_store'],
];
const HISTORICAL_FUEL_WRITE_PREFIXES = [
  '/api/admin/fuel/historical-incomplete',
  '/api/admin/fuel/audit-comments',
  '/api/admin/deposits/', // dated correction routes still enforce their own manager/OTP checks
  '/api/admin/otp/',
  '/api/admin/users',
  '/api/admin/billing/',
  '/api/admin/organization', // profile, logo, and OTP destination are safe during historical review
  '/api/admin/settings/payments', // subscription payment setup does not alter station stock
  '/api/admin/me/',
  '/api/admin/exceptions',
  '/api/admin/notifications',
  '/api/admin/chat/', // customer communication does not change live fuel stock
];

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
      const businessForPath = BUSINESS_API_PREFIXES.find(([prefix]) => path.startsWith(prefix))?.[1];
      const serviceType = requiredService || businessForPath;
      const isWrite = !['GET', 'HEAD'].includes(request.method);
      const org = serviceType || isWrite
        ? await prisma.organization.findUnique({ where: { id: orgId }, select: { businessType: true } })
        : null;
      if (serviceType) {
        const service = org?.businessType === serviceType
          ? await prisma.service.findFirst({ where: { type: serviceType }, select: { id: true, isActive: true, config: true } })
          : null;
        const isHistoricalFuel = serviceType === 'fuel_station' && service?.config?.migrationStockPending === true;
        if (!service || (!service.isActive && !isHistoricalFuel)) return NextResponse.json({ error: 'This business is not active for your organization' }, { status: 403 });
        if (isHistoricalFuel && isWrite &&
            !['/api/admin/fuel/historical-incomplete', '/api/admin/fuel/audit-comments'].some((prefix) => path.startsWith(prefix))) {
          return NextResponse.json({ error: 'Historical review is available; live station changes require signed opening tank readings' }, { status: 409 });
        }
      }
      if (isWrite && org?.businessType === 'fuel_station' && path.startsWith('/api/admin/')) {
        const fuel = await prisma.service.findFirst({ where: { type: 'fuel_station' }, select: { config: true } });
        if (fuel?.config?.migrationStockPending === true && !HISTORICAL_FUEL_WRITE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
          return NextResponse.json({ error: 'Live station changes require signed opening tank readings' }, { status: 409 });
        }
      }
      return handler(request, context);
    });
  };
}
