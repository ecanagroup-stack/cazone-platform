import { requireBusinessPage } from '@/lib/businessPage';
import { getOrgSession } from '@/lib/session';
import Link from 'next/link';

export default async function FuelLayout({ children }) {
  const service = await requireBusinessPage('fuel_station');
  const session = await getOrgSession();
  return <>
    {service.config?.migrationStockPending === true && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><div><strong>Station setup is incomplete.</strong> New shifts are paused because opening stock has not been signed since the transaction reset. Enter the actual dip reading for every active tank to start operations.</div>{session?.user?.role === 'owner' ? <Link href={`/admin/fuel/activate?service=${service.id}`} className="shrink-0 rounded-lg bg-amber-900 px-4 py-2 font-semibold text-white hover:bg-amber-800">Set opening stock</Link> : <span className="shrink-0 font-semibold">The account owner must complete setup.</span>}</div>}
    {children}
  </>;
}
