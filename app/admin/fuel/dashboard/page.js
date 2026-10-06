import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds } from '@/lib/branchAccess';
import { requireOrg } from '@/lib/tenantScope';
import { Card } from '@/components/ui';

const ROLE_VIEW = {
  owner: { title: 'Station Overview', subtitle: 'Shifts, sales, cash collections and review across your stations' },
  manager: { title: 'Manager Dashboard', subtitle: 'Run the shift and review supervisor and cashier entries' },
  staff: { title: 'Station Dashboard', subtitle: 'See your station shift and assigned work' },
  supervisor: { title: 'Supervisor Dashboard', subtitle: 'Record pump sales and tank measurements for your station' },
  cashier: { title: 'Cashier Dashboard', subtitle: 'Record pump handovers and monitor collections' },
  daily_auditor: { title: 'Daily Auditor Dashboard', subtitle: 'Review the operating day and flag differences' },
  external_auditor: { title: 'External Auditor Dashboard', subtitle: 'Inspect station reports and reconciliation history' },
  auditor: { title: 'Auditor Dashboard', subtitle: 'Inspect station reports and reconciliation history' },
};

const ACTIONS = {
  owner: [['Open station shift', '/admin/fuel/shift'], ['Review summary book', '/admin/fuel/summary-book'], ['Manage branches', '/admin/services'], ['Subscription', '/admin/billing']],
  manager: [['Begin or end shift', '/admin/fuel/shift'], ['Review pump entries', '/admin/fuel/shift'], ['Tank stock', '/admin/fuel/tanks'], ['Summary book', '/admin/fuel/summary-book']],
  staff: [['View station shift', '/admin/fuel/shift']],
  supervisor: [['Record pump sales', '/admin/fuel/shift'], ['Record tank dip', '/admin/fuel/tanks']],
  cashier: [['Record payments', '/admin/fuel/collections'], ['View pump collections', '/admin/fuel/collections'], ['Complete historical sales', '/admin/fuel/historical-incomplete']],
  daily_auditor: [['Daily summary', '/admin/fuel/summary-book'], ['Tank stock', '/admin/fuel/tanks'], ['Flags', '/admin/exceptions']],
  external_auditor: [['Daily summary', '/admin/fuel/summary-book'], ['Flags', '/admin/exceptions']],
  auditor: [['Daily summary', '/admin/fuel/summary-book'], ['Tank stock', '/admin/fuel/tanks'], ['Flags', '/admin/exceptions']],
};

const money = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export default async function FuelDashboard({ searchParams }) {
  const params = await searchParams;
  const session = await getOrgSession();
  requireOrg(session);
  const role = session.user.role;
  const access = await getAccessibleBranchIds(session);
  const service = await prisma.service.findFirst({ where: { type: 'fuel_station' }, select: { id: true, config: true, branches: { where: { isActive: true, ...(access ? { id: { in: access } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } } } });
  const historicalOnly = service.config?.migrationStockPending === true;
  const view = ROLE_VIEW[role] || { title: 'Petrol Station', subtitle: 'Your station workspace' };
  const selectedBranch = service.branches.find((branch) => branch.id === params?.branch) || (service.branches.length === 1 ? service.branches[0] : null);
  const link = (path) => `${path}?${new URLSearchParams({ service: service.id, ...(selectedBranch ? { branch: selectedBranch.id } : {}) })}`;

  if (!selectedBranch) return <div className="space-y-5"><div><h1 className="text-2xl font-bold text-gray-900">{view.title}</h1><p className="mt-1 text-sm text-gray-500">Choose a station to continue.</p></div><div className="grid gap-3 sm:grid-cols-2">{service.branches.map((branch) => <Link key={branch.id} href={`/admin/fuel/dashboard?service=${service.id}&branch=${branch.id}`} className="rounded-xl border bg-white p-5 font-semibold hover:border-brand-500">{branch.name} →</Link>)}</div></div>;

  const openShift = await prisma.shift.findFirst({ where: { branchId: selectedBranch.id, status: 'open' }, select: { id: true, shiftLabel: true, operatingDate: true, openedAt: true }, orderBy: { openedAt: 'desc' } });
  const latestShift = historicalOnly ? await prisma.shift.findFirst({ where: { branchId: selectedBranch.id }, select: { operatingDate: true }, orderBy: { openedAt: 'desc' } }) : null;
  const operatingDate = openShift?.operatingDate || latestShift?.operatingDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const [sales, collections, deposits, pending] = await Promise.all([
    prisma.meterReading.aggregate({ where: { branchId: selectedBranch.id, shift: { operatingDate }, ...(role === 'supervisor' ? { recordedBy: session.user.id } : {}), litres: { gt: 0 } }, _sum: { litres: true, expectedAmount: true }, _count: true }),
    prisma.fuelCollection.aggregate({ where: { branchId: selectedBranch.id, operatingDate, voidedAt: null, ...(role === 'cashier' ? { recordedBy: session.user.id } : {}) }, _sum: { totalAmount: true }, _count: true }),
    prisma.cashDeposit.aggregate({ where: { branchId: selectedBranch.id, operatingDate, ...(role === 'cashier' ? { initiatedBy: session.user.id } : {}) }, _sum: { amount: true }, _count: true }),
    prisma.meterReading.count({ where: { branchId: selectedBranch.id, shift: { operatingDate }, reviewStatus: 'pending', closing: { not: null } } }),
  ]);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-brand-700">{selectedBranch.name} · {operatingDate}</p><h1 className="mt-1 text-2xl font-bold text-gray-900">{view.title}</h1><p className="mt-1 text-sm text-gray-500">{view.subtitle}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${openShift ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{openShift ? `${openShift.shiftLabel || 'Shift'} open` : 'No open shift'}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="p-5"><p className="text-xs text-gray-500">Pump sales</p><p className="mt-1 text-2xl font-bold">{(sales._sum.litres || 0).toLocaleString('en-NG')} L</p><p className="text-xs text-gray-500">{sales._count} recorded entries</p></Card>
      <Card className="p-5"><p className="text-xs text-gray-500">Expected sales value</p><p className="mt-1 text-2xl font-bold">{money(sales._sum.expectedAmount || 0)}</p></Card>
      <Card className="p-5"><p className="text-xs text-gray-500">Recorded collections</p><p className="mt-1 text-2xl font-bold">{money(collections._sum.totalAmount || 0)}</p><p className="text-xs text-gray-500">{collections._count} handovers</p></Card>
      <Card className="p-5"><p className="text-xs text-gray-500">Bank deposits</p><p className="mt-1 text-2xl font-bold">{money(deposits._sum.amount || 0)}</p><p className="text-xs text-gray-500">{deposits._count} records</p></Card>
    </div>
    {['manager', 'owner'].includes(role) && pending > 0 && <Link href={link('/admin/fuel/shift')} className="block rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">{pending} pump {pending === 1 ? 'entry needs' : 'entries need'} manager review →</Link>}
    <div><h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Your work</h2><div className="grid gap-3 sm:grid-cols-2">{(historicalOnly ? [['Review summary book', '/admin/fuel/summary-book'], ...(['owner', 'manager', 'cashier'].includes(role) ? [['Complete historical sales', '/admin/fuel/historical-incomplete']] : []), ...(role === 'owner' ? [['Manage subscription', '/admin/billing']] : [])] : (ACTIONS[role] || [])).map(([label, path]) => <Link key={`${label}-${path}`} href={link(path)} className="rounded-xl border bg-white p-5 font-medium text-gray-900 shadow-sm transition hover:border-brand-500 hover:shadow-md">{label}<span className="float-right text-brand-600">→</span></Link>)}</div></div>
  </div>;
}
