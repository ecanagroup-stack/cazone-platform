import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { runUnscoped, runWithOrg } from '@/lib/tenantScope';
import { verifySignature } from '@/lib/paystack';
import { provisionRequest } from '@/lib/provisioning';
import { createSaleOrder, priceLines } from '@/lib/sale';
import { allocatePayment } from '@/lib/payments';
import { logAudit } from '@/lib/audit';
import { loadOrgCustomerFlags } from '@/lib/orgLookup';
import { classifyAtcPayment } from '@/lib/petroleumAtc.mjs';
import { notifyRoleUsers } from '@/lib/notify';
import { formatMoney } from '@/lib/format';

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

  // Customer payment collection (app/api/portal/pay/balance, app/api/portal/shop/pay) — a customer
  // paying their own org through Cazone, split via that org's Paystack Subaccount at the point of
  // charge (see Organization.paystackSubaccountCode). Distinct from the subscription/provisioning
  // branches above, which are this org paying CAZONE. The metadata is client-supplied and can be missing or
  // stripped, so these branch on the type alone and never fall through to the subscription code below, which
  // would credit a customer's money to an org's subscription. An ATC charge is also recognised by the
  // reference the server issued, and handleAtcOrderPayment finds its org from the saved row.
  if (metadata.type === 'balance_payment') {
    await handleBalancePayment(data, metadata);
    return;
  }
  if (metadata.type === 'shop_order') {
    await handleShopOrderPayment(data, metadata);
    return;
  }
  if (metadata.type === 'atc_order' || String(data.reference || '').startsWith('atc_')) {
    await handleAtcOrderPayment(data, metadata);
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

// The metadata is client-supplied, so confirm the org still has the customer feature the payment needs
// (lib/customerAccess.mjs) before writing against it. Money may already be taken (e.g. the distributor
// add-on lapsed mid-payment) — when the org exists, leave a Flag so the Admin can refund or reconcile
// instead of dropping it silently; the dedupe row is already written, so Paystack won't retry.
async function canApplyCustomerPayment(data, metadata, flag) {
  const { organizationId, customerId } = metadata;
  if (typeof organizationId !== 'string' || !organizationId || typeof customerId !== 'string' || !customerId) {
    console.error('[paystack webhook] customer payment not applied: metadata incomplete', metadata.type, data.reference); // eslint-disable-line no-console
    return false;
  }
  return orgHasCustomerFeature(data, metadata.type, organizationId, flag);
}

async function orgHasCustomerFeature(data, type, organizationId, flag) {
  const flags = await loadOrgCustomerFlags(organizationId);
  if (flags[flag]) return true;
  console.error('[paystack webhook] customer payment not applied: feature unavailable', type, data.reference); // eslint-disable-line no-console
  if (flags.businessType) {
    await runWithOrg(organizationId, () => prisma.flag.create({ data: {
      targetType: 'Payment', targetId: data.reference || null, severity: 'issue', classification: 'issue',
      reason: `A ${{ shop_order: 'shop order', atc_order: 'ATC order' }[type] || 'balance'} payment of ${data.amount / 100} (Paystack ref ${data.reference}) was received but not applied: customers are not available for this business. Refund or reconcile it manually.`,
      raisedBy: 'system:paystack',
    } }));
  }
  return false;
}

// A customer paying down their own balance (app/api/portal/pay/balance) — same effect as the
// staff-recorded Record Payment (app/api/admin/customers/[id]/payments), just customer-initiated and
// tagged 'paystack' so it's visibly distinct on the statement. Runs org-scoped since the webhook
// itself carries no session.
async function handleBalancePayment(data, metadata) {
  const { customerId, organizationId } = metadata;
  const amount = data.amount; // already kobo — Payment.amount matches Order.grandTotal's convention
  if (!(await canApplyCustomerPayment(data, metadata, 'hasCustomers'))) return;
  await runWithOrg(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { customerId, amount, method: 'paystack', reference: data.reference, recordedBy: null },
      });
      await allocatePayment(tx, { customerId, paymentId: payment.id, amount });
      await tx.customer.update({ where: { id: customerId }, data: { balance: { decrement: amount } } });
    }, { timeout: 15000 })
  );
}

// A customer paying for a Shop order immediately, in full, rather than placing it on credit
// (app/api/portal/shop/pay) — reuses createSaleOrder exactly like a staff-recorded cash sale would:
// stock decrements now, nothing added to the customer's balance (paymentMethod isn't 'credit'), no
// staff confirmation step to wait on since the money's already real. The metadata is client-supplied,
// so only product and quantity are taken from its lines, and the order is priced from scratch here
// (never trusted from the client's earlier prepare-time total — core-algorithms skill §1) with the
// customer's own transport rate. If what Paystack actually collected doesn't cover that total
// (a tampered checkout, or a price that rose in between) no order is made: it's flagged for a refund.
async function handleShopOrderPayment(data, metadata) {
  const { customerId, organizationId, branchId } = metadata;
  if (!(await canApplyCustomerPayment(data, metadata, 'hasOrdering'))) return;
  if (!branchId || !Array.isArray(metadata.lines) || metadata.lines.length === 0) return;
  const lines = metadata.lines.map((line) => ({ productId: line?.productId, qty: line?.qty }));
  await runWithOrg(organizationId, async () => {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { transportRate: true } });
    const transportFee = customer?.transportRate || 0;
    const { subtotal } = await priceLines(lines, customerId);
    if (!(data.amount >= subtotal + transportFee)) {
      await prisma.flag.create({ data: {
        targetType: 'Payment', targetId: data.reference || null, severity: 'issue', classification: 'issue',
        reason: `A shop order payment of ${data.amount / 100} (Paystack ref ${data.reference}) was received but is less than the order total of ${(subtotal + transportFee) / 100}, so no order was created. Refund or reconcile it manually.`,
        raisedBy: 'system:paystack',
      } });
      return;
    }
    await createSaleOrder({
      session: { user: { organizationId, id: null } },
      branchId, customerId, paymentMethod: 'paystack', lines,
      transportFee, channel: 'shop', stockReason: 'sale',
    });
  });
}

// A customer buying an ATC online (app/api/portal/atc/orders). The ATC is found by the reference saved on
// its own row when the hold was made, never by anything in the client-supplied metadata (which is only a
// last resort for naming the org when no row carries the reference), and the amount Paystack actually
// collected is checked against the price saved on that row. The popup's own settings (currency, split) are
// browser-controlled, so the charge must also be in NGN and settled to this org's own subaccount. The flip
// reserved -> sold is one conditional update, and a redelivered webhook is already stopped by the
// PaystackEvent row. Money that cannot buy the ATC (the hold lapsed and it went elsewhere, it was taken off
// sale, the amount is short, it went to the wrong account or the customer was deactivated) is never
// silently kept: a Flag and a notice to the Admin and ATC managers ask for a refund.
async function handleAtcOrderPayment(data, metadata) {
  const reference = data.reference;
  const held = reference ? await prisma.petroleumAtc.findFirst({ where: { paystackReference: reference }, select: { organizationId: true } }) : null;
  const organizationId = held?.organizationId || (typeof metadata.organizationId === 'string' ? metadata.organizationId : null);
  if (!organizationId) {
    console.error('[paystack webhook] ATC payment not applied: no ATC or organization for', reference); // eslint-disable-line no-console
    return;
  }
  if (!(await orgHasCustomerFeature(data, 'atc_order', organizationId, 'hasAtc'))) return;
  const paidKobo = Number(data.amount);
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { paystackSubaccountCode: true } });
  const chargeSubaccount = typeof data.subaccount === 'string' ? data.subaccount : data.subaccount?.subaccount_code;
  const settledToOrg = data.currency === 'NGN' && !!org?.paystackSubaccountCode && chargeSubaccount === org.paystackSubaccountCode;
  await runWithOrg(organizationId, async () => {
    const load = (where) => prisma.petroleumAtc.findFirst({
      where,
      select: {
        id: true, serial: true, litres: true, productId: true, vehicleId: true, status: true, reservedByCustomerId: true,
        paystackReference: true, totalPrice: true, product: { select: { name: true } },
        vehicle: { select: { plateNumber: true, driverName: true, driverPhone: true } },
      },
    });
    const atc = reference ? await load({ paystackReference: reference }) : null;
    let outcome = classifyAtcPayment(atc, { reference, paidKobo });

    let customer = null;
    if (outcome === 'apply') {
      customer = await prisma.customer.findUnique({ where: { id: atc.reservedByCustomerId }, select: { name: true, isActive: true } });
      if (!settledToOrg) outcome = 'misdirected';
      else if (!customer?.isActive) outcome = 'inactive';
    }

    if (outcome === 'apply') {
      const now = new Date();
      const claimed = await prisma.petroleumAtc.updateMany({
        // Litres and fuel are part of the claim: an edit since the hold would change what the price was for.
        where: { id: atc.id, status: 'reserved', paystackReference: reference, reservedByCustomerId: atc.reservedByCustomerId, litres: atc.litres, productId: atc.productId },
        data: {
          status: 'sold', customerId: atc.reservedByCustomerId, paymentMethod: 'paystack', paidAt: now, soldAt: now,
          reservedUntil: null, reservedByCustomerId: null,
          truckPlate: atc.vehicle.plateNumber, driverName: atc.vehicle.driverName, driverPhone: atc.vehicle.driverPhone,
        },
      });
      if (claimed.count === 1) {
        await logAudit({
          organizationId, actorUserId: 'system:paystack', actorName: 'Paystack payment',
          action: 'petroleum_atc.sold', entityType: 'PetroleumAtc', entityId: atc.id,
          after: { serial: atc.serial, customerId: atc.reservedByCustomerId, litres: atc.litres, totalPrice: Number(atc.totalPrice), paymentMethod: 'paystack', reference },
        });
        await notifyRoleUsers(['atc_manager', 'owner'], {
          type: 'atc_sold', title: 'ATC sold',
          message: `${atc.serial} (${atc.litres.toLocaleString('en-NG')} L ${atc.product.name}) paid online by ${customer?.name || 'a customer'} for ${formatMoney(Number(atc.totalPrice) / 100)}. Truck ${atc.vehicle.plateNumber}.`,
          relatedType: 'PetroleumAtc', relatedId: atc.id,
        });
        return;
      }
      // Lost the race: re-read to tell this charge's own earlier success from the ATC going elsewhere.
      outcome = classifyAtcPayment(await load({ paystackReference: reference }), { reference, paidKobo }) === 'already_applied' ? 'already_applied' : 'conflict';
    }
    if (outcome === 'already_applied') return;

    // The ATC this charge was for, when the reference no longer points at it (another buyer's hold replaced it).
    const target = atc || (typeof metadata.atcId === 'string' ? await load({ id: metadata.atcId }) : null);
    const serial = target?.serial ? ` for ${target.serial}` : '';
    const paid = `an ATC payment${serial} of ${paidKobo / 100} (Paystack ref ${reference})`;
    const reason = {
      underpaid: `paid_conflict: ${paid} is less than the price of ${Number(atc?.totalPrice) / 100}, so the ATC was not sold. Refund or reconcile it manually.`,
      misdirected: `paid_conflict: ${paid} was not paid in NGN to this business's own Paystack subaccount, so the ATC was not sold. Check where the money settled, then refund or reconcile it manually.`,
      inactive: `paid_conflict: ${paid} was received but the customer's account is no longer active, so the ATC was not sold. Refund or reconcile it manually.`,
    }[outcome] || `paid_conflict: ${paid} was received but the ATC is no longer held for this customer (the 15-minute hold ended and it went elsewhere, or it was taken off sale). Refund the customer or reconcile it manually.`;
    await prisma.flag.create({ data: {
      targetType: 'PetroleumAtc', targetId: target?.id || data.reference || null, severity: 'issue', classification: 'issue', reason, raisedBy: 'system:paystack',
    } });
    await notifyRoleUsers(['atc_manager', 'owner'], {
      type: 'atc_paid_conflict', title: 'ATC payment needs a refund',
      message: `A customer paid ${formatMoney(paidKobo / 100)}${serial} (Paystack ref ${reference}) but the ATC could not be sold to them. Refund or reconcile it.`,
      relatedType: target ? 'PetroleumAtc' : null, relatedId: target?.id || null,
    });
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
