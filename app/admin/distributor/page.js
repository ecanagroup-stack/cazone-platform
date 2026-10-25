import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { can } from '@/lib/permissions';
import { lagosDayRange } from '@/lib/businessDates.mjs';
import { businessToday } from '@/lib/saleDates.mjs';
import { sellableWhere } from '@/lib/petroleumAtc.mjs';
import { Card, PageHeader, btnPrimaryCls } from '@/components/ui';
import SoldBoard from '@/components/distributor/SoldBoard';

export default async function DistributorDashboard() {
  const session = await getOrgSession();
  requireOrg(session);
  const role = session.user.role;
  const canView = can(role, 'atc.view');
  if (!canView && !can(role, 'atc.sell')) notFound();

  const today = businessToday();
  const [onSale, awaiting, deliveredToday] = await Promise.all([
    prisma.petroleumAtc.count({ where: sellableWhere() }),
    canView ? prisma.petroleumAtc.count({ where: { status: 'sold' } }) : 0,
    canView ? prisma.petroleumAtc.count({ where: { status: 'delivered', deliveredAt: lagosDayRange({ from: today, to: today }) } }) : 0,
  ]);

  const stats = [
    { label: 'Unsold ATCs', value: onSale, href: '/admin/distributor/atcs' },
    ...(canView ? [
      { label: 'Sold, awaiting delivery', value: awaiting, href: '/admin/distributor/orders' },
      { label: 'Delivered today', value: deliveredToday, href: '/admin/distributor/orders' },
    ] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Petroleum Distributor"
        subtitle="ATCs on sale, paid and waiting for the driver, and delivered today"
        action={can(role, 'atc.sell') && <Link href="/admin/distributor/sell" className={btnPrimaryCls}>Sell an ATC</Link>}
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="p-4 hover:border-brand-500">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold">{stat.value}</p>
            </Card>
          </Link>
        ))}
      </div>
      {canView && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Sold ATCs</h2>
          <SoldBoard />
        </>
      )}
    </div>
  );
}
