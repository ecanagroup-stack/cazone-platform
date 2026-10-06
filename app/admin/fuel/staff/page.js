import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

const STAFF_ROLES = ['manager', 'supervisor', 'cashier', 'staff'];

export default async function FuelStaffPage({ searchParams }) {
  const session = await getOrgSession();
  requireOrg(session);
  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  if (org?.businessType !== 'fuel_station' || !['owner', 'manager'].includes(session.user.role)) notFound();
  const access = await getAccessibleBranchIds(session);
  const params = await searchParams;
  const users = await prisma.user.findMany({
    where: { role: { in: STAFF_ROLES }, ...(access ? { branchAccess: { some: { branchId: { in: access } } } } : {}) },
    select: { id: true, name: true, role: true, username: true, email: true, isActive: true, branchAccess: { where: { branch: { service: { type: 'fuel_station' } } }, select: { branch: { select: { id: true, name: true } } } } },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  const filtered = params?.branch ? users.filter((user) => user.branchAccess.some(({ branch }) => branch.id === params.branch)) : users;

  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-brand-700">People</p><h1 className="mt-1 text-3xl font-bold">Station Staff</h1><p className="mt-1 text-sm text-gray-500">Managers, supervisors, cashiers, and station staff with their assigned branches.</p></div><Link href="/admin/users" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">Manage users</Link></div><div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Login</th><th className="px-4 py-3">Stations</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y">{filtered.map((user) => <tr key={user.id}><td className="px-4 py-3 font-medium">{user.name}</td><td className="px-4 py-3 capitalize">{user.role.replaceAll('_', ' ')}</td><td className="px-4 py-3 text-gray-600">{user.username || user.email || '—'}</td><td className="px-4 py-3 text-gray-600">{user.branchAccess.map(({ branch }) => branch.name).join(', ') || 'All accessible stations'}</td><td className="px-4 py-3"><span className={user.isActive ? 'text-green-700' : 'text-gray-500'}>{user.isActive ? 'Active' : 'Inactive'}</span></td></tr>)}{filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No staff found for this station.</td></tr>}</tbody></table></div></div>;
}
