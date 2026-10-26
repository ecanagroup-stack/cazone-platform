'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Card, EmptyState, Loader, NumberInput, PageHeader, btnPrimaryCls } from '@/components/ui';

export default function TankStockPage() {
  const branchId = useSearchParams().get('branch') || '';
  const [tanks, setTanks] = useState(null);
  const [openShift, setOpenShift] = useState(false);
  const [measuring, setMeasuring] = useState(null);
  const [litres, setLitres] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) { setTanks(null); return; }
    const [response, shiftResponse] = await Promise.all([
      fetch(`/api/admin/fuel/tanks?branchId=${encodeURIComponent(branchId)}`),
      fetch(`/api/admin/fuel/shift?branchId=${encodeURIComponent(branchId)}`),
    ]);
    const result = await response.json();
    const shiftResult = await shiftResponse.json();
    if (result.success) setTanks(result.data.tanks);
    else toast.error(result.error || 'Could not load tank stock');
    setOpenShift(Boolean(shiftResult.success && shiftResult.data?.shift));
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const record = async (event) => {
    event.preventDefault();
    if (!measuring) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/fuel/tanks/${measuring.id}/reconcile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ measured: Number(litres) }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Could not record dip');
      toast.success('Tank measurement recorded');
      setMeasuring(null); setLitres(''); load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5">
    <PageHeader title="Tank Dipstick" subtitle="Measure each tank during the station shift" />
    {!branchId ? <Card><EmptyState title="Choose a station" subtitle="Select your station in the top bar." /></Card>
      : !tanks ? <Loader /> : <div className="grid gap-4 sm:grid-cols-2">
        {tanks.filter((tank) => tank.isActive).map((tank) => <Card key={tank.id} className="p-5">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{tank.label}</h2><p className="text-sm text-gray-500">{tank.product.name} · {tank.capacity.toLocaleString()} L capacity</p></div><span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">Active</span></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-gray-500">Last physical dip</p><p className="font-semibold">{tank.lastPhysicalDip ? `${tank.lastPhysicalDip.measured.toLocaleString()} L` : 'None recorded'}</p></div><div><p className="text-xs text-gray-500">Product ledger</p><p className="font-semibold">{tank.onHand.toLocaleString()} L</p></div></div>
          {tank.lastPhysicalDip && <p className="mt-2 text-xs text-gray-500">Measured {new Date(tank.lastPhysicalDip.createdAt).toLocaleString('en-NG')}</p>}
          {openShift ? <button type="button" onClick={() => { setMeasuring(tank); setLitres(''); }} className="mt-4 text-sm font-semibold text-brand-700 hover:underline">Record dip →</button> : <p className="mt-4 text-xs text-gray-500">A manager must open the shift before you record a dip.</p>}
        </Card>)}
        {tanks.filter((tank) => tank.isActive).length === 0 && <Card><EmptyState title="No active tanks" subtitle="Ask your manager to configure this station." /></Card>}
      </div>}
    {measuring && <Card className="p-5"><form onSubmit={record} className="space-y-3"><h2 className="font-semibold">Measure {measuring.label}</h2><label className="block text-sm font-medium">Physical litres</label><NumberInput required min="0" value={litres} onChange={(event) => setLitres(event.target.value)} /><div className="flex gap-3"><button type="submit" disabled={saving} className={btnPrimaryCls}>{saving ? 'Recording...' : 'Record measurement'}</button><button type="button" onClick={() => setMeasuring(null)} className="rounded border px-4 py-2 text-sm">Cancel</button></div></form></Card>}
  </div>;
}
