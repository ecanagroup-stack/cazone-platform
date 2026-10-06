import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

export default async function FuelStationsPage({ searchParams }) {
  const session = await getOrgSession();
  requireOrg(session);
  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  if (org?.businessType !== 'fuel_station' || !['owner', 'manager'].includes(session.user.role)) notFound();
  const access = await getAccessibleBranchIds(session);
  const service = await prisma.service.findFirst({ where: { type: 'fuel_station' }, select: { id: true, config: true } });
  if (!service) notFound();
  const branches = await prisma.branch.findMany({
    where: { serviceId: service.id, ...(access ? { id: { in: access } } : {}) },
    select: { id: true, name: true, code: true, address: true, isActive: true, _count: { select: { tanks: true, dispensers: true, attendants: true, shifts: true } } },
    orderBy: { name: 'asc' },
  });
  const params = await searchParams;
  const selected = branches.find((branch) => branch.id === params?.branch);
  const href = (path, branch) => `${path}?service=${service.id}&branch=${branch.id}`;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Fuel station network</p><h1 className="mt-1 text-3xl font-bold text-gray-900">Stations</h1><p className="mt-1 text-sm text-gray-500">Each branch keeps its own pumps, tanks, shifts, and staff access.</p></div><Link href="/admin/services" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">Manage branches</Link></div>
    {service.config?.migrationStockPending === true && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Historical station records are available. Live stock work resumes after signed opening tank readings are entered.</div>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{branches.map((branch) => <div key={branch.id} className={`rounded-xl border bg-white p-5 shadow-sm ${selected?.id === branch.id ? 'border-brand-500' : 'border-gray-200'}`}><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">{branch.name}</h2><p className="text-xs text-gray-500">{branch.code}{branch.address ? ` · ${branch.address}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-xs font-medium ${branch.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{branch.isActive ? 'Active' : 'Inactive'}</span></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><strong>{branch._count.tanks}</strong><span className="ml-1 text-gray-500">tanks</span></div><div><strong>{branch._count.dispensers}</strong><span className="ml-1 text-gray-500">pumps</span></div><div><strong>{branch._count.attendants}</strong><span className="ml-1 text-gray-500">attendants</span></div><div><strong>{branch._count.shifts}</strong><span className="ml-1 text-gray-500">shifts</span></div></div><div className="mt-5 flex flex-wrap gap-3 text-sm font-medium text-brand-700"><Link href={href('/admin/fuel/dashboard', branch)}>Dashboard</Link><Link href={href('/admin/fuel/summary-book', branch)}>Summary book</Link><Link href={href('/admin/fuel/tanks', branch)}>Configuration</Link></div></div>)}</div>
    {branches.length === 0 && <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">No stations are assigned to this account.</p>}
  </div>;
}
