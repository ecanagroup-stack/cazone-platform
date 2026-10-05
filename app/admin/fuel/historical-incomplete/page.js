'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Card, EmptyState, Loader, OtpField, PageHeader, inputCls, btnPrimaryCls } from '@/components/ui';

export default function HistoricalIncompletePage() {
  const branchId = useSearchParams().get('branch') || '';
  const { data: session } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [closing, setClosing] = useState('');
  const [rtt, setRtt] = useState('0');
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [tankId, setTankId] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const canSubmit = ['cashier', 'manager', 'owner'].includes(session?.user?.role);
  const canApprove = ['manager', 'owner'].includes(session?.user?.role);
  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      const response = await fetch(`/api/admin/fuel/historical-incomplete?branchId=${encodeURIComponent(branchId)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load incomplete history');
      setData(body); setError('');
    } catch (e) { setError(e.message); }
  }, [branchId]);
  useEffect(() => { load(); }, [load]);
  const choose = (row) => {
    setSelected(row); setClosing(row.closing ?? ''); setRtt(row.rtt ?? 0);
    setReason(''); setOtp(''); setTankId(''); setPrice('');
  };
  const submit = async (method) => {
    setSaving(true);
    try {
      const chosenTank = data.tanks.find((tank) => tank.id === tankId);
      const payload = method === 'POST'
        ? { readingId: selected.id, closing, rtt, reason, otp }
        : { readingId: selected.id, reason, tankId, productId: chosenTank?.productId, pricePerLiter: price };
      const response = await fetch('/api/admin/fuel/historical-incomplete', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Correction failed');
      toast.success(method === 'POST' ? 'Sent for manager review' : 'Historical sale approved');
      setSelected(null); await load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return <div>
    <PageHeader title="Incomplete Historical Pump Records" subtitle="Closed shifts remain stored; incomplete meters need cashier evidence and manager approval" />
    {!branchId ? <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher." /></Card>
      : !data ? <Loader /> : <Card className="p-4 space-y-4">
        {error && <p className="text-red-700">{error}</p>}
        <p className="text-sm text-gray-600">These source meters have no saved sale. They contribute no revenue, stock movement, or attendant debt until approved.</p>
        {data.data.length === 0 ? <p>No incomplete imported meters in this branch.</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left">
            <th className="p-2">Date</th><th className="p-2">Pump</th><th className="p-2">Opening</th><th className="p-2">Closing</th><th className="p-2">Status</th><th className="p-2">Action</th>
          </tr></thead><tbody>{data.data.map((row) => <tr key={row.id} className="border-t">
            <td className="p-2">{row.operatingDate}</td><td className="p-2">{row.pump}</td>
            <td className="p-2">{row.opening}</td><td className="p-2">{row.closing ?? 'Missing'}</td>
            <td className="p-2">{row.status === 'historical_review' ? 'Awaiting manager' : 'Incomplete'}</td>
            <td className="p-2"><button type="button" className="text-brand-600 underline" onClick={() => choose(row)}>Review</button></td>
          </tr>)}</tbody></table></div>}
      </Card>}
    {selected && <Card className="p-4 mt-4 space-y-3 max-w-xl">
      <h2 className="font-semibold">{selected.operatingDate} · {selected.pump}</h2>
      <p className="text-xs text-gray-500">Source meter {selected.sourceId}. Original MongoDB entry remains archived.</p>
      {canSubmit && <div className="space-y-2 border-b pb-4">
        <h3 className="font-medium">Cashier correction</h3>
        <label className="block text-sm">Closing reading<input className={inputCls} type="number" step="0.001" value={closing} onChange={(e) => setClosing(e.target.value)} /></label>
        <label className="block text-sm">Return to tank (L)<input className={inputCls} type="number" step="0.001" value={rtt} onChange={(e) => setRtt(e.target.value)} /></label>
        <label className="block text-sm">Evidence and reason<textarea className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <OtpField purpose="historical_fuel_correction" value={otp} onChange={setOtp} />
        <button type="button" disabled={saving || !otp} className={btnPrimaryCls} onClick={() => submit('POST')}>Submit for review</button>
      </div>}
      {canApprove && selected.status === 'historical_review' && <div className="space-y-2">
        <h3 className="font-medium">Manager approval</h3>
        <p className="text-sm">Cashier evidence: {selected.note}</p>
        <label className="block text-sm">Historical tank and product<select className={inputCls} value={tankId} onChange={(e) => setTankId(e.target.value)}>
          <option value="">Select tank</option>{data.tanks.map((tank) => <option key={tank.id} value={tank.id}>{tank.label} · {tank.product}</option>)}
        </select></label>
        <label className="block text-sm">Verified price per litre (₦)<input className={inputCls} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="block text-sm">Approval evidence and reason<textarea className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button type="button" disabled={saving || !tankId || !price} className={btnPrimaryCls} onClick={() => submit('PATCH')}>Approve verified sale</button>
      </div>}
    </Card>}
  </div>;
}
