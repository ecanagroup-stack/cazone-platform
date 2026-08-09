import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { Card, StatusPill } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { CAZONE_BANK_DETAILS } from '@/lib/billing';
import { isLapsed } from '@/components/shell/LapsedBanner';

const statusColor = { trialing: 'blue', active: 'green', past_due: 'amber', canceled: 'gray' };

export default async function BillingPage() {
  const session = await getOrgSession();
  const orgId = requireOrg(session);

  const [org, serviceCount, branchCount] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.service.count(),
    prisma.branch.count(),
  ]);

  const lapsed = isLapsed(org);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500 mt-1">Your plan, usage, and how to pay.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-xs text-gray-500">Status</p>
          <div className="mt-1">
            {org.freeForever
              ? <StatusPill status="Free forever" color="green" />
              : <StatusPill status={org.subscriptionStatus} color={statusColor[org.subscriptionStatus] || 'gray'} />}
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">{org.subscriptionEndsAt ? 'Paid through' : 'Trial ends'}</p>
          <p className="text-lg font-bold mt-1">{org.freeForever ? '—' : formatDate(org.subscriptionEndsAt || org.trialEndsAt)}</p>
        </Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Services in use</p><p className="text-2xl font-bold mt-1">{serviceCount}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Branches in use</p><p className="text-2xl font-bold mt-1">{branchCount}</p></Card>
      </div>

      {lapsed && (
        <Card className="p-4 mb-6 border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-800">Your subscription needs attention. Pay using the details below, then let us know so we can confirm it — nothing you're already doing is affected.</p>
        </Card>
      )}

      {!org.freeForever && (
        <Card className="p-5 mb-6">
          <h3 className="font-semibold text-sm mb-4">Pay by bank transfer</h3>
          <div className="space-y-1.5 text-sm max-w-sm">
            <div className="flex justify-between"><span className="text-gray-500">Bank</span><span className="font-medium">{CAZONE_BANK_DETAILS.bankName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Account number</span><span className="font-medium">{CAZONE_BANK_DETAILS.accountNumber}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Account name</span><span className="font-medium">{CAZONE_BANK_DETAILS.accountName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Reference</span><span className="font-medium">{org.slug}</span></div>
          </div>
          <p className="text-xs text-gray-500 mt-4">Include the reference above so we can match your payment. After paying, contact support to confirm — automatic confirmation isn't wired up yet.</p>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-semibold text-sm mb-1">Invoice history</h3>
        <p className="text-sm text-gray-500">Nothing to show yet.</p>
      </Card>
    </div>
  );
}
