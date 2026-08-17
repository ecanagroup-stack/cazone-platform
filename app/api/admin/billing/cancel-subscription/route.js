import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { fetchSubscription, disableSubscription } from '@/lib/paystack';
import { ApiError } from '@/lib/apiError';

// Owner-only — asks Paystack to stop future auto-charges. Doesn't itself flip subscriptionStatus:
// the webhook's subscription.disable handler is what actually confirms the cancellation server-side,
// same "never trust the client-initiated step, only the webhook" rule the subscribe flow follows.
export const POST = withOrg(async () => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can manage billing' }, { status: 403 });
  }
  try {
    const orgId = session.user.organizationId;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org?.paystackSubscriptionCode) throw new ApiError('No active Paystack subscription to cancel', 400);

    const subscription = await fetchSubscription(org.paystackSubscriptionCode);
    const emailToken = subscription?.email_token;
    if (!emailToken) throw new ApiError('Could not retrieve this subscription from Paystack', 502);

    await disableSubscription({ subscriptionCode: org.paystackSubscriptionCode, emailToken });
    return NextResponse.json({ success: true, message: 'Cancellation requested — this stops future charges once Paystack confirms it' });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
