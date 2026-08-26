import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { listBanks, createOrUpdateSubaccount } from '@/lib/paystack';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

function requireOwner(session) {
  if (session?.user?.role !== 'owner') throw new ApiError('Only the organization owner can manage payment collection', 403);
}

// Owner-only, same as Billing/Settings generally. Bank list comes from Paystack's own /bank endpoint
// (live, not hardcoded) so it always matches what Paystack itself will accept for account resolution.
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  try {
    requireOwner(session);
    const org = await prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      select: { paymentsEnabled: true, payoutBankCode: true, payoutBankName: true, payoutAccountNumber: true, payoutAccountName: true },
    });
    const platformSettings = await runUnscoped(() => prisma.platformSettings.findUnique({ where: { id: 'singleton' } }));
    const [banks] = await Promise.all([listBanks()]);
    return NextResponse.json({
      success: true,
      data: { ...org, feePercent: platformSettings?.paymentCollectionFeePercent ?? 1.5, banks },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});

// Enables (or re-saves) payment collection — creates the org's Paystack Subaccount if this is the
// first time, or updates it (new bank details, or the platform fee changed since) otherwise. Every
// customer charge (lib/sale.js createSaleOrder, app/api/portal/pay) splits against this subaccount
// from here on; nothing retroactively re-splits an already-settled past charge.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  try {
    requireOwner(session);
    const body = await request.json();
    const { bankCode, bankName, accountNumber, accountName } = body;
    if (!bankCode || !bankName || !accountNumber || !accountName) {
      throw new ApiError('Bank, account number, and a verified account name are all required', 400);
    }

    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId } });
    const platformSettings = await runUnscoped(() => prisma.platformSettings.findUnique({ where: { id: 'singleton' } }));
    const feePercent = platformSettings?.paymentCollectionFeePercent ?? 1.5;

    const { subaccountCode } = await createOrUpdateSubaccount({
      existingCode: org.paystackSubaccountCode,
      businessName: org.name,
      bankCode, accountNumber,
      percentageCharge: feePercent,
    });

    const updated = await prisma.organization.update({
      where: { id: session.user.organizationId },
      data: {
        paymentsEnabled: true, paystackSubaccountCode: subaccountCode,
        payoutBankCode: bankCode, payoutBankName: bankName, payoutAccountNumber: accountNumber, payoutAccountName: accountName,
      },
    });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'organization.payments_enabled', entityType: 'Organization', entityId: session.user.organizationId,
      after: { bankName, accountNumber: accountNumber.replace(/\d(?=\d{4})/g, '•'), accountName, feePercent },
    });

    return NextResponse.json({ success: true, data: { paymentsEnabled: updated.paymentsEnabled } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const DELETE = withOrg(async () => {
  const session = await getOrgSession();
  try {
    requireOwner(session);
    await prisma.organization.update({ where: { id: session.user.organizationId }, data: { paymentsEnabled: false } });
    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'organization.payments_disabled', entityType: 'Organization', entityId: session.user.organizationId,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
