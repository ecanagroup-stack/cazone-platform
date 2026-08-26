import crypto from 'node:crypto';
import { ApiError } from './apiError';

// Thin fetch-based wrapper — Paystack's API is plain REST/JSON, no SDK needed. Every amount going TO
// Paystack must already be in kobo (the smallest NGN unit); Organization.monthlyPrice and
// ProvisioningRequest.quotedAmount are both stored in whole Naira (this schema's one deliberate
// exception to "money fields are always the smallest unit" — see their comments), so callers convert
// with `* 100` before reaching here, never inside these functions.
const BASE_URL = 'https://api.paystack.co';

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new ApiError('Paystack isn\'t configured for this deployment yet — ask an admin to set PAYSTACK_SECRET_KEY', 400);
  return key;
}

async function paystackFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    throw new ApiError(data.message || `Paystack request failed (${res.status})`, 502);
  }
  return data.data;
}

// One Paystack customer per org, created lazily on first subscribe — reused (and cached on
// Organization.paystackCustomerCode) for every later transaction/plan subscription.
export async function getOrCreateCustomer(org) {
  if (org.paystackCustomerCode) return org.paystackCustomerCode;
  const customer = await paystackFetch('/customer', {
    method: 'POST',
    body: { email: org.email || org.otpEmail, first_name: org.name, metadata: { organizationId: org.id } },
  });
  return customer.customer_code;
}

// A Plan is created lazily per org, at whatever monthlyPrice is current — if the price has changed
// since the last plan was created (paystackPlanAmount mismatch), a NEW plan is created rather than
// mutating the old one, since Paystack plans are effectively immutable once subscribers exist on them.
// Returns { planCode, amountKobo } — callers persist both onto Organization.
export async function getOrCreatePlan(org) {
  const amountKobo = Math.round(Number(org.monthlyPrice) * 100);
  if (!amountKobo || amountKobo <= 0) throw new ApiError('This organization has no monthly price set yet', 400);
  if (org.paystackPlanCode && org.paystackPlanAmount === amountKobo) {
    return { planCode: org.paystackPlanCode, amountKobo };
  }
  const plan = await paystackFetch('/plan', {
    method: 'POST',
    body: { name: `${org.name} — Monthly`, amount: amountKobo, interval: 'monthly', currency: org.currency || 'NGN' },
  });
  return { planCode: plan.plan_code, amountKobo };
}

// Initializes a transaction — with `plan` for a subscription (first charge or a card-change resubmit),
// without it for a one-time provisioning payment. Returns { authorizationUrl, accessCode, reference }.
export async function initializeTransaction({ email, amountKobo, reference, plan, metadata }) {
  const data = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: { email, amount: amountKobo, reference, plan, metadata, channels: ['card'] },
  });
  return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
}

// NGN bank list for the "which bank" dropdown in Settings' payment-collection setup — `type=nuban`
// both matches how /bank/resolve actually works (a NUBAN account number) and avoids Paystack's full
// list containing multiple entries that share a `code` (e.g. a bank's mobile-money variant), which
// would otherwise produce duplicate React keys in the dropdown.
export async function listBanks() {
  const data = await paystackFetch('/bank?currency=NGN&type=nuban');
  const seen = new Set();
  const banks = [];
  for (const b of data) {
    if (seen.has(b.code)) continue;
    seen.add(b.code);
    banks.push({ name: b.name, code: b.code });
  }
  return banks;
}

// Confirms an account number actually belongs to the name Paystack has on file for it, BEFORE an
// owner can enable payment collection — a typo'd account number would otherwise silently send a
// real org's customer payments to a stranger's bank account.
export async function resolveAccountNumber(accountNumber, bankCode) {
  const data = await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
  return { accountName: data.account_name };
}

// Creates (or, if the org already has one, updates) the Paystack Subaccount that every customer
// charge for this org gets split against — see Organization.paystackSubaccountCode's comment.
// `percentageCharge` is Cazone's cut (PlatformSettings.paymentCollectionFeePercent at the time this
// is called), baked into the subaccount itself so every future split honors whatever the platform
// rate was when the org last (re)enabled collection, not a rate looked up per-transaction.
export async function createOrUpdateSubaccount({ existingCode, businessName, bankCode, accountNumber, percentageCharge }) {
  const body = { business_name: businessName, bank_code: bankCode, account_number: accountNumber, percentage_charge: percentageCharge };
  if (existingCode) {
    const data = await paystackFetch(`/subaccount/${existingCode}`, { method: 'PUT', body });
    return { subaccountCode: data.subaccount_code || existingCode };
  }
  const data = await paystackFetch('/subaccount', { method: 'POST', body });
  return { subaccountCode: data.subaccount_code };
}

export async function disableSubscription({ subscriptionCode, emailToken }) {
  return paystackFetch('/subscription/disable', {
    method: 'POST', body: { code: subscriptionCode, token: emailToken },
  });
}

export async function fetchSubscription(subscriptionCode) {
  return paystackFetch(`/subscription/${subscriptionCode}`);
}

// HMAC-SHA512 of the raw request body using the secret key — the signature scheme Paystack documents
// for webhook verification. Must be computed against the exact raw bytes, before any JSON.parse, or
// the digest won't match (this is why app/api/webhooks/paystack/route.js reads request.text() first).
export function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  // timingSafeEqual requires equal-length buffers — a length mismatch just means "not equal",
  // not a crash, so guard it before comparing.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
