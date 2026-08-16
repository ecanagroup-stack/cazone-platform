import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// "me" only — a portal session's customerId comes from the server-issued JWT (lib/auth.js), never
// from a client-supplied id, so there's no route param to guard against cross-customer access.
export const GET = withOrg(async () => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);
    const customer = await prisma.customer.findUnique({ where: { id: session.user.customerId } });
    if (!customer) throw new ApiError('Not found', 404);
    return NextResponse.json({ success: true, data: customer });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
