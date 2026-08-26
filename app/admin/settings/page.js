import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { Card } from '@/components/ui';
import OrganizationProfileForm from '@/components/shell/OrganizationProfileForm';
import OtpSettingsCard from '@/components/shell/OtpSettingsCard';
import PaymentCollectionCard from '@/components/shell/PaymentCollectionCard';

// Owner-only — logo/profile/invoicing/security all live here now, consolidated instead of scattered
// (the OTP Security card moves here from Billing, which stays subscription-only).
export default async function SettingsPage() {
  const session = await getOrgSession();
  const orgId = requireOrg(session);
  const org = await prisma.organization.findUnique({ where: { id: orgId } });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Your organization's profile, invoicing details, and security.</p>
      </div>

      {session.user.role !== 'owner' ? (
        <Card className="p-6 text-center text-sm text-gray-500">Only the organization owner can view and change these settings.</Card>
      ) : (
        <>
          <OrganizationProfileForm org={org} />
          <OtpSettingsCard org={org} />
          <PaymentCollectionCard />
        </>
      )}
    </div>
  );
}
