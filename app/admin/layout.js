import { redirect } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import prisma from '@/lib/prisma';
import { getCachedOrganization } from '@/lib/orgLookup';
import TopBar from '@/components/shell/TopBar';
import Sidebar from '@/components/shell/Sidebar';
import LapsedBanner from '@/components/shell/LapsedBanner';

// Every page under here reads the session and the org's live data — never statically prerenderable.
// Without this, Next can attempt a build-time static pass on a page that happens not to touch any
// other dynamic API (e.g. a page with no searchParams usage), which then fails when it hits
// getServerSession() with no real request context (surfaces as a cryptic `new URL('')` crash).
export const dynamic = 'force-dynamic';

// The signed-in org's own logo as the favicon while inside /admin — falls through to the root
// layout's (Cazone's own logo) when the org hasn't uploaded one, since returning no `icons` key
// here means Next.js metadata inheritance leaves the parent's value in place.
export async function generateMetadata() {
  const session = await getOrgSession();
  if (!session || session.user.role === 'super_admin') return {};
  const orgId = requireOrg(session);
  const organization = await getCachedOrganization(orgId);
  const icon = organization?.logoUrlSmall || organization?.logoUrl;
  return icon ? { icons: { icon } } : {};
}

export default async function AdminLayout({ children }) {
  const session = await getOrgSession();
  if (!session) redirect('/login');
  if (session.user.role === 'super_admin') redirect('/platform/organizations');

  const orgId = requireOrg(session);
  const [organization, services] = await Promise.all([
    getCachedOrganization(orgId),
    prisma.service.findMany({
      where: { isActive: true },
      include: { branches: { where: { isActive: true }, orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar org={organization} services={services} user={session.user} />
      <LapsedBanner org={organization} />
      <div className="flex flex-1">
        <Sidebar enabledTypes={services.map((s) => s.type)} />
        <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
      </div>
    </div>
  );
}
