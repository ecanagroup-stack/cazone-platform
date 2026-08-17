import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Owner-only — prepares a one-time Paystack charge for this org's own quoted provisioning request
// (no plan, unlike billing/subscribe — a new branch/business is a single payment, not recurring).
// metadata carries the requestId so the webhook (app/api/webhooks/paystack/route.js) knows which
// request a successful charge.success belongs to and calls lib/provisioning.js's provisionRequest.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can pay for this' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const orgId = session.user.organizationId;
    const reqRow = await prisma.provisioningRequest.findUnique({ where: { id } });
    if (!reqRow || reqRow.organizationId !== orgId) throw new ApiError('Request not found', 404);
    if (reqRow.status !== 'quoted') throw new ApiError('This request isn\'t ready to pay for yet', 400);
    if (reqRow.quotedAmount == null) throw new ApiError('No quote has been set for this request', 400);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    const email = org.email || org.otpEmail || session.user.email;
    if (!email) throw new ApiError('Set a company email or OTP email for this organization first, from Billing or Settings', 400);

    const amountKobo = Math.round(Number(reqRow.quotedAmount) * 100);
    const reference = `prov_${id}_${Date.now()}`;
    await prisma.provisioningRequest.update({ where: { id }, data: { paystackReference: reference } });

    return NextResponse.json({ success: true, data: { reference, amountKobo, email, requestId: id } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
