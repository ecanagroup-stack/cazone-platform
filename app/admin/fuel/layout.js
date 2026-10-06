import { requireBusinessPage } from '@/lib/businessPage';

export default async function FuelLayout({ children }) {
  const service = await requireBusinessPage('fuel_station');
  return <>
    {service.config?.migrationStockPending === true && <div role="status" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>Historical review mode.</strong> Imported shifts and reports are available. New station activity is paused until signed tank readings establish opening stock.</div>}
    {children}
  </>;
}
