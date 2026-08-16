import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { Logo } from '@/components/ui';
import SignOutButton from '@/components/SignOutButton';

// Cross-tenant super-admin console — deliberately its own minimal chrome, not the tenant Sell/
// Manage/Know shell (this isn't a business dashboard, it's the platform operator's own console).
export default async function PlatformLayout({ children }) {
  const session = await getOrgSession();
  if (!session || session.user.role !== 'super_admin') redirect('/login');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="h-14 border-b bg-gray-900 text-white flex items-center px-4 gap-4">
        <Link href="/platform/organizations" className="flex items-center gap-2">
          <Logo className="h-7 w-7" />
          <span className="font-semibold">Cazone Platform</span>
        </Link>
        <span className="text-xs bg-white/10 px-2 py-0.5 rounded">super_admin</span>
        <Link href="/platform/organizations" className="text-sm text-gray-300 hover:text-white">Organizations</Link>
        <Link href="/platform/services" className="text-sm text-gray-300 hover:text-white">Service Catalog</Link>
        <div className="flex-1" />
        <span className="text-sm text-gray-300">{session.user.name}</span>
        <SignOutButton className="text-sm text-gray-300 hover:text-white" />
      </header>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  );
}
