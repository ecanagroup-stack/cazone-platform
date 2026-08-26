import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

// Prepares a customer's self-service payment against their own account balance — the actual charge
// happens client-side via Paystack's popup (components/billing/PaystackButton.js), split against the
// org's Paystack Subaccount so their share settles directly to their bank account. Nothing here
// touches the balance; only a confirmed webhook (app/api/webhooks/paystack, metadata.type ===
// 'balance_payment') ever does.
export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);

    const org = await prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      select: { paymentsEnabled: true, paystackSubaccountCode: true },
    });
    if (!org?.paymentsEnabled || !org.paystackSubaccountCode) {
      throw new ApiError('This organization isn\'t set up to collect payments online', 400);
    }

    const customer = await prisma.customer.findUnique({ where: { id: session.user.customerId }, select: { name: true, email: true, phone: true } });
    if (!customer) throw new ApiError('Customer not found', 404);

    const body = await request.json();
    const amountKobo = Math.round(Number(body.amount));
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) throw new ApiError('Enter a valid amount', 400);

    // Paystack requires an email; a phone-only portal login (the common case here) doesn't have one —
    // a synthesized address tied to the customer keeps receipts scoped to them, not the org.
    const email = customer.email || `customer-${session.user.customerId}@cazone.app`;

    const reference = `bal_${session.user.customerId}_${Date.now()}`;
    return NextResponse.json({
      success: true,
      data: { reference, amountKobo, email, subaccountCode: org.paystackSubaccountCode },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
