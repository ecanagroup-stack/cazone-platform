import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { runUnscoped } from '@/lib/tenantScope';
import { verifySignature } from '@/lib/paystack';
import { provisionRequest } from '@/lib/provisioning';
import { logAudit } from '@/lib/audit';

// The only source of truth for anything Paystack-related actually taking effect — every client-side
// "payment succeeded" callback (components/billing/PaystackButton.js) is purely optimistic UI, never
// itself trusted. No session, no withOrg: Paystack has no session, and which org a payload belongs to
// is only known after parsing it (metadata for a client-initiated charge, paystackCustomerCode lookup
// for a Paystack-initiated recurring renewal, which carries no metadata at all).
//
// Idempotency: a PaystackEvent row is inserted (keyed by event+reference) BEFORE applying any effect —
// a unique-constraint violation means this exact delivery was already processed, so it's skipped
// (Paystack retries webhook delivery on anything but a 200). Trade-off, accepted deliberately: if the
// effect itself throws AFTER that row exists, a retry will no-op instead of reapplying — rare in
// practice since the only work here is DB writes, no further network calls once the signature's
// verified, and matches how most idempotency-key webhook handlers accept this same edge case.
export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = payload.event;
  const data = payload.data || {};
  const dedupeKey = `${event}:${data.reference || data.subscription_code || data.id || ''}`;

  try {
    await runUnscoped(async () => {
      try {
        await prisma.paystackEvent.create({ data: { reference: dedupeKey, event } });
      } catch (e) {
        if (e.code === 'P2002') return; // already processed this exact delivery — skip, still 200
        throw e;
      }

      if (event === 'charge.success') await handleChargeSuccess(data);
      else if (event === 'subscription.create') await handleSubscriptionCreate(data);
      else if (event === 'subscription.disable') await handleSubscriptionDisable(data);
      else if (event === 'invoice.payment_failed') await handlePaymentFailed(data);
      // Anything else: acknowledged, no handler — Paystack sends many events we don't act on.
    });
  } catch (e) {
    console.error('[paystack webhook]', event, e); // eslint-disable-line no-console
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 }); // Paystack will retry
  }

  return NextResponse.json({ received: true });
}

async function handleChargeSuccess(data) {
  const metadata = data.metadata || {};

  if (metadata.type === 'provisioning' && metadata.requestId) {
    await provisionRequest(metadata.requestId, { note: `Paid via Paystack (ref ${data.reference})` });
    return;
  }

  // Subscription payment — the first charge carries metadata.organizationId (set by
  // components/billing/PaystackButton.js); a later Paystack-initiated renewal charge carries no
  // metadata at all, so it's resolved by the customer code instead.
  let org = null;
  if (metadata.organizationId) {
    org = await prisma.organization.findUnique({ where: { id: metadata.organizationId } });
  } else if (data.customer?.customer_code) {
    org = await prisma.organization.findFirst({ where: { paystackCustomerCode: data.customer.customer_code } });
  }
  if (!org) return; // Not a payment we can attribute — acknowledge and move on.

  const base = org.subscriptionEndsAt && org.subscriptionEndsAt > new Date() ? org.subscriptionEndsAt : new Date();
  const subscriptionEndsAt = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000); // monthly only (v1) — matches extend-subscription's own 30-day month

  const update = { subscriptionStatus: 'active', subscriptionEndsAt };
  if (!org.paystackCustomerCode && data.customer?.customer_code) update.paystackCustomerCode = data.customer.customer_code;

  await prisma.organization.update({ where: { id: org.id }, data: update });
  await logAudit({
    organizationId: org.id, actorUserId: 'system:paystack', actorName: 'Paystack payment',
    action: 'organization.subscription_paid', entityType: 'Organization', entityId: org.id,
    after: { subscriptionEndsAt, reference: data.reference },
  });
}

// charge.success doesn't reliably carry the subscription_code the first time a plan-linked charge
// succeeds — subscription.create is Paystack's dedicated event for that, fired right after.
async function handleSubscriptionCreate(data) {
  const customerCode = data.customer?.customer_code;
  if (!customerCode || !data.subscription_code) return;
  const org = await prisma.organization.findFirst({ where: { paystackCustomerCode: customerCode } });
  if (!org || org.paystackSubscriptionCode === data.subscription_code) return;
  await prisma.organization.update({ where: { id: org.id }, data: { paystackSubscriptionCode: data.subscription_code } });
}

async function handleSubscriptionDisable(data) {
  if (!data.subscription_code) return;
  const org = await prisma.organization.findFirst({ where: { paystackSubscriptionCode: data.subscription_code } });
  if (!org) return;
  await prisma.organization.update({ where: { id: org.id }, data: { subscriptionStatus: 'canceled' } });
  await logAudit({
    organizationId: org.id, actorUserId: 'system:paystack', actorName: 'Paystack payment',
    action: 'organization.subscription_canceled', entityType: 'Organization', entityId: org.id, after: { subscriptionStatus: 'canceled' },
  });
}

async function handlePaymentFailed(data) {
  const customerCode = data.customer?.customer_code || data.subscription?.customer?.customer_code;
  if (!customerCode) return;
  const org = await prisma.organization.findFirst({ where: { paystackCustomerCode: customerCode } });
  if (!org) return;
  await prisma.organization.update({ where: { id: org.id }, data: { subscriptionStatus: 'past_due' } });
}
