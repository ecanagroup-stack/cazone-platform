import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { Card, EmptyState, btnPrimaryCls } from '@/components/ui';

// Org-wide by default — "the organization's admin can see any and all his business" — with an
// honest empty state rather than fabricated numbers, since no pack has any sales/variance data yet.
export default async function TodayPage() {
  const session = await getOrgSession();
  const orgId = requireOrg(session);

  const [services, staffCount] = await Promise.all([
    prisma.service.findMany({ include: { branches: true }, orderBy: { createdAt: 'asc' } }),
    prisma.user.count({ where: { role: { not: 'customer' } } }),
  ]);

  const branchCount = services.reduce((sum, s) => sum + s.branches.length, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Today</h1>
        <p className="text-sm text-gray-500 mt-1">Across all services and branches, as of now.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-4"><p className="text-xs text-gray-500">Services enabled</p><p className="text-2xl font-bold mt-1">{services.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Branches</p><p className="text-2xl font-bold mt-1">{branchCount}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Staff</p><p className="text-2xl font-bold mt-1">{staffCount}</p></Card>
      </div>

      <Card>
        <EmptyState
          title="No sales, cash-up or variance data yet"
          subtitle="Today will show cash taken, account sales and anything that needs attention once a service's counter screens are connected. For now, get the basics set up."
          action={
            <div className="flex gap-3 justify-center flex-wrap">
              <Link href="/admin/services" className={btnPrimaryCls}>Manage services &amp; branches</Link>
              <Link href="/admin/users" className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">Invite a user</Link>
            </div>
          }
        />
      </Card>
    </div>
  );
}
