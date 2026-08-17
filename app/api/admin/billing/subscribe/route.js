import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { getOrCreateCustomer, getOrCreatePlan } from '@/lib/paystack';
import { ApiError } from '@/lib/apiError';

// Owner-only — prepares (but does not itself charge) a subscription: ensures a Paystack customer and
// a Plan matching the org's current monthlyPrice exist, and returns everything the client needs to
// hand to PaystackPop.setup (components/billing/PaystackButton.js). The actual charge happens
// client-side via Paystack's popup; the ONLY thing that ever marks the subscription as paid is the
// webhook (app/api/webhooks/paystack/route.js) — this route never touches subscriptionStatus.
export const POST = withOrg(async () => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can manage billing' }, { status: 403 });
  }
  try {
    const orgId = session.user.organizationId;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new ApiError('Organization not found', 404);
    if (org.freeForever) throw new ApiError('This organization is exempt from billing', 400);
    const email = org.email || org.otpEmail || session.user.email;
    if (!email) throw new ApiError('Set a company email or OTP email for this organization first, from Billing or Settings', 400);

    const customerCode = await getOrCreateCustomer(org);
    if (customerCode !== org.paystackCustomerCode) {
      await prisma.organization.update({ where: { id: orgId }, data: { paystackCustomerCode: customerCode } });
    }

    const { planCode, amountKobo } = await getOrCreatePlan(org);
    if (planCode !== org.paystackPlanCode || amountKobo !== org.paystackPlanAmount) {
      await prisma.organization.update({ where: { id: orgId }, data: { paystackPlanCode: planCode, paystackPlanAmount: amountKobo } });
    }

    const reference = `sub_${orgId}_${Date.now()}`;
    return NextResponse.json({ success: true, data: { planCode, reference, email, amountKobo, organizationId: orgId } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
