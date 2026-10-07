import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { getCachedOrganization } from '@/lib/orgLookup';
import { OrgLogo } from '@/components/ui';
import SignOutButton from '@/components/SignOutButton';
import PortalMessagesLink from '@/components/PortalMessagesLink';
import PortalAnnouncementsLink from '@/components/PortalAnnouncementsLink';
import LinkSearch from '@/components/shell/LinkSearch';

// Customer portal — deliberately its own minimal chrome, not the staff Sell/Manage/Know shell. A
// customer session only ever sees their own account, never the org's operational screens.
// Never statically prerenderable — see app/admin/layout.js's dynamic export for why.
export const dynamic = 'force-dynamic';

// The org's own logo as the favicon while inside /portal — falls through to the root layout's
// (Cazone's own logo) when the org hasn't uploaded one, same mechanism as app/admin/layout.js.
export async function generateMetadata() {
  const session = await getOrgSession();
  if (!session || session.user.role !== 'customer') return {};
  const orgId = requireOrg(session);
  const organization = await getCachedOrganization(orgId);
  const icon = organization?.logoUrlSmall || organization?.logoUrl;
  return icon ? { icons: { icon } } : {};
}

export default async function PortalLayout({ children }) {
  const session = await getOrgSession();
  if (!session || session.user.role !== 'customer') redirect('/login');

  const orgId = requireOrg(session);
  const org = await getCachedOrganization(orgId);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="print:hidden h-14 border-b bg-white flex items-center px-4 gap-4">
        <Link href="/portal" className="flex items-center gap-2">
          <OrgLogo org={org} dim="h-7 w-7" />
          <span className="font-semibold">{session.user.organizationName}</span>
        </Link>
        <nav className="hidden md:flex items-center gap-4 text-sm text-gray-600">
          <Link href="/portal" className="hover:text-gray-900">Overview</Link>
          {org?.businessType === 'shop' && <Link href="/portal/shop" className="hover:text-gray-900">Shop</Link>}
          <Link href="/portal/statement" className="hover:text-gray-900">Statement</Link>
          <PortalMessagesLink className="hover:text-gray-900" />
          <PortalAnnouncementsLink className="hover:text-gray-900" />
          <Link href="/portal/account" className="hover:text-gray-900">Account</Link>
        </nav>
        <div className="flex-1" />
        <LinkSearch links={[
          { href: '/portal', label: 'Overview', group: 'Account' },
          ...(org?.businessType === 'shop' ? [{ href: '/portal/shop', label: 'Shop', group: 'Shop' }] : []),
          { href: '/portal/statement', label: 'Statement', group: 'Account' },
          { href: '/portal/messages', label: 'Messages', group: 'Account' },
          { href: '/portal/announcements', label: 'Notifications', group: 'Account' },
          { href: '/portal/account', label: 'My Account', group: 'Account' },
        ]} />
        <span className="hidden lg:inline text-sm text-gray-500">{session.user.name}</span>
        <SignOutButton className="text-sm text-gray-500 hover:text-gray-900" />
      </header>
      <nav aria-label="Customer navigation" className="flex items-center justify-around gap-2 border-b bg-white px-3 py-2 text-xs text-gray-700 md:hidden">
        <Link href="/portal">Overview</Link>
        <PortalMessagesLink />
        <PortalAnnouncementsLink />
        <Link href="/portal/account">Account</Link>
      </nav>
      <main className="max-w-3xl mx-auto p-6">{children}</main>
    </div>
  );
}
