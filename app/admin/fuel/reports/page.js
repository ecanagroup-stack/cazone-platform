import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

const money = (amount) => `₦${((amount || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '');

export default async function FuelReportsPage({ searchParams }) {
  const session = await getOrgSession();
  requireOrg(session);
  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  if (org?.businessType !== 'fuel_station' || !['owner', 'manager', 'auditor', 'daily_auditor', 'external_auditor'].includes(session.user.role)) notFound();
  const access = await getAccessibleBranchIds(session);
  const service = await prisma.service.findFirst({ where: { type: 'fuel_station' }, select: { id: true } });
  if (!service) notFound();
  const branches = await prisma.branch.findMany({ where: { serviceId: service.id, ...(access ? { id: { in: access } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const params = await searchParams;
  const branchId = branches.some((branch) => branch.id === params?.branch) ? params.branch : '';
  const branchIds = branchId ? [branchId] : branches.map((branch) => branch.id);
  const latestShift = await prisma.shift.findFirst({ where: { branchId: { in: branchIds } }, select: { operatingDate: true }, orderBy: { operatingDate: 'desc' } });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const anchor = latestShift?.operatingDate || today;
  const from = validDate(params?.from) ? params.from : `${anchor.slice(0, 7)}-01`;
  const to = validDate(params?.to) ? params.to : anchor;
  const dateRange = from <= to ? { gte: from, lte: to } : { gte: to, lte: from };
  const shifts = await prisma.shift.findMany({ where: { branchId: { in: branchIds }, operatingDate: dateRange }, select: { id: true, branchId: true, operatingDate: true, status: true } });
  const shiftIds = shifts.map((shift) => shift.id);
  const [readings, collections, deposits] = shiftIds.length ? await Promise.all([
    prisma.meterReading.findMany({ where: { shiftId: { in: shiftIds }, closing: { not: null } }, select: { shiftId: true, litres: true, expectedAmount: true, collectionCoverage: true } }),
    prisma.fuelCollection.findMany({ where: { shiftId: { in: shiftIds }, voidedAt: null }, select: { shiftId: true, totalAmount: true } }),
    prisma.cashDeposit.findMany({ where: { shiftId: { in: shiftIds } }, select: { shiftId: true, amount: true } }),
  ]) : [[], [], []];
  const byShift = Object.fromEntries(shifts.map((shift) => [shift.id, shift]));
  const branchNames = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]));
  const rows = new Map();
  for (const shift of shifts) {
    const key = `${shift.operatingDate}|${shift.branchId}`;
    const row = rows.get(key) || { date: shift.operatingDate, branch: branchNames[shift.branchId], shiftCount: 0, openCount: 0, litres: 0, expected: 0, collected: 0, deposited: 0, unknown: 0 };
    row.shiftCount += 1;
    if (shift.status !== 'closed') row.openCount += 1;
    rows.set(key, row);
  }
  const rowFor = (shiftId) => { const shift = byShift[shiftId]; return rows.get(`${shift.operatingDate}|${shift.branchId}`); };
  for (const reading of readings) { const row = rowFor(reading.shiftId); row.litres += reading.litres || 0; row.expected += reading.expectedAmount || 0; if (reading.collectionCoverage === 'unknown') row.unknown += 1; }
  for (const collection of collections) rowFor(collection.shiftId).collected += collection.totalAmount || 0;
  for (const deposit of deposits) rowFor(deposit.shiftId).deposited += deposit.amount || 0;
  const reportRows = [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.branch.localeCompare(b.branch));
  const totals = reportRows.reduce((sum, row) => ({ litres: sum.litres + row.litres, expected: sum.expected + row.expected, collected: sum.collected + row.collected, deposited: sum.deposited + row.deposited, unknown: sum.unknown + row.unknown }), { litres: 0, expected: 0, collected: 0, deposited: 0, unknown: 0 });

  return <div className="space-y-5"><div><p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Fuel records</p><h1 className="mt-1 text-3xl font-bold">Station Reports</h1><p className="mt-1 text-sm text-gray-500">Operating day sales, verified handovers, and bank deposits across your stations.</p></div><form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"><input type="hidden" name="service" value={service.id}/><label className="text-sm">Station<select name="branch" defaultValue={branchId} className="mt-1 block rounded-lg border px-3 py-2"><option value="">All accessible stations</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="text-sm">From<input name="from" type="date" defaultValue={dateRange.gte} className="mt-1 block rounded-lg border px-3 py-2"/></label><label className="text-sm">To<input name="to" type="date" defaultValue={dateRange.lte} className="mt-1 block rounded-lg border px-3 py-2"/></label><button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">Run report</button></form><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Litres sold', `${totals.litres.toLocaleString('en-NG')} L`], ['Expected sales', money(totals.expected)], ['Recorded collections', money(totals.collected)], ['Bank deposits', money(totals.deposited)], ['Unknown collections', totals.unknown.toLocaleString('en-NG')]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div><p className="text-xs text-gray-500">Unknown collections are historical sales without a verified payment record. They are not counted as settled or as attendant debt.</p><div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Operating day</th><th className="px-4 py-3">Station</th><th className="px-4 py-3 text-right">Shifts</th><th className="px-4 py-3 text-right">Litres</th><th className="px-4 py-3 text-right">Expected</th><th className="px-4 py-3 text-right">Collected</th><th className="px-4 py-3 text-right">Deposited</th><th className="px-4 py-3 text-right">Unknown</th></tr></thead><tbody className="divide-y">{reportRows.map((row) => <tr key={`${row.date}-${row.branch}`}><td className="px-4 py-3 font-medium">{row.date}</td><td className="px-4 py-3">{row.branch}</td><td className="px-4 py-3 text-right">{row.shiftCount}{row.openCount ? ` (${row.openCount} open)` : ''}</td><td className="px-4 py-3 text-right">{row.litres.toLocaleString('en-NG')}</td><td className="px-4 py-3 text-right">{money(row.expected)}</td><td className="px-4 py-3 text-right">{money(row.collected)}</td><td className="px-4 py-3 text-right">{money(row.deposited)}</td><td className="px-4 py-3 text-right">{row.unknown || '—'}</td></tr>)}{reportRows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No station shifts in this period.</td></tr>}</tbody></table></div><Link href={`/admin/fuel/summary-book?service=${service.id}${branchId ? `&branch=${branchId}` : ''}`} className="inline-block text-sm font-semibold text-brand-700">Open detailed summary book →</Link></div>;
}
