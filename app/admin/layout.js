import { redirect } from 'next/navigation';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import prisma from '@/lib/prisma';
import TopBar from '@/components/shell/TopBar';
import Sidebar from '@/components/shell/Sidebar';
import LapsedBanner from '@/components/shell/LapsedBanner';

export default async function AdminLayout({ children }) {
  const session = await getOrgSession();
  if (!session) redirect('/login');
  if (session.user.role === 'super_admin') redirect('/platform/organizations');

  const orgId = requireOrg(session);
  const [organization, services] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
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
