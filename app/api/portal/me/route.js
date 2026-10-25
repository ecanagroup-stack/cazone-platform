import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { loadOrgCustomerFlags } from '@/lib/orgLookup';

// "me" only — a portal session's customerId comes from the server-issued JWT (lib/auth.js), never
// from a client-supplied id, so there's no route param to guard against cross-customer access.
export const GET = withOrg(async () => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);
    const [customer, org, flags] = await Promise.all([
      prisma.customer.findUnique({ where: { id: session.user.customerId } }),
      prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { name: true, paymentsEnabled: true, businessType: true } }),
      loadOrgCustomerFlags(session.user.organizationId),
    ]);
    if (!customer) throw new ApiError('Not found', 404);
    return NextResponse.json({ success: true, data: { ...customer, organizationName: org?.name, paymentsEnabled: org?.paymentsEnabled || false, businessType: org?.businessType, hasOrdering: flags.hasOrdering, hasAtc: flags.hasAtc } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
