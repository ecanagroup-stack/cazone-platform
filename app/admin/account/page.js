import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { Card, ChangePasswordForm } from '@/components/ui';

export default async function AccountPage() {
  const session = await getOrgSession();
  const orgId = requireOrg(session);
  const [user, organization] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, role: true, email: true, username: true, phone: true, branchAccess: { select: { branch: { select: { name: true } } } } } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, businessType: true, otpEmail: true } }),
  ]);
  const login = user?.email || user?.username || user?.phone || 'No login identifier';
  const otpDestination = organization?.otpEmail;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-gray-900">My Account</h1><p className="mt-1 text-sm text-gray-500">Your sign-in details and account security for {organization?.name}.</p></div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5"><h2 className="font-semibold text-gray-900">Your access</h2><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-gray-500">Name</dt><dd className="font-medium">{user?.name}</dd></div><div><dt className="text-gray-500">Login</dt><dd className="font-medium">{login}</dd></div><div><dt className="text-gray-500">Role</dt><dd className="font-medium capitalize">{user?.role?.replaceAll('_', ' ')}</dd></div><div><dt className="text-gray-500">{organization?.businessType === 'fuel_station' ? 'Stations' : 'Branches'}</dt><dd className="font-medium">{user?.role === 'owner' || !user?.branchAccess?.length ? 'All' : user.branchAccess.map(({ branch }) => branch.name).join(', ')}</dd></div></dl></Card>
      <Card className="p-5"><h2 className="mb-4 font-semibold text-gray-900">Change password</h2><ChangePasswordForm /></Card>
    </div>
    {session.user.role === 'owner' && <Card className="p-5"><h2 className="font-semibold text-gray-900">Business account</h2><p className="mt-2 text-sm text-gray-600">Admin verification codes go only to <strong>{otpDestination || 'a separately configured OTP email'}</strong>.{!otpDestination && ' Set this address before requesting a code.'}</p><div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-brand-700"><Link href="/admin/settings#security">Set admin OTP email</Link><Link href="/admin/settings">Business settings</Link><Link href="/admin/billing">Subscription</Link></div></Card>}
  </div>;
}
