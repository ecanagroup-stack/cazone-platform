import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { runWithOrg } from './tenantScope';

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
    if (requiredService && !hasService(session, requiredService)) {
      return NextResponse.json({ error: 'This service is not enabled for your organization' }, { status: 403 });
    }
    const orgId = session?.user?.organizationId;
    if (!orgId) return handler(request, context);
    return runWithOrg(orgId, () => handler(request, context));
  };
}
