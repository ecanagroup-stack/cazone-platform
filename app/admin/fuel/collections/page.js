'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Card, EmptyState, Field, Loader, NumberInput, PageHeader, btnPrimaryCls, inputCls } from '@/components/ui';

function todayInLagos() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

export default function FuelCollectionsPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';
  const { data: session } = useSession();
  const canCollect = ['cashier', 'manager', 'owner'].includes(session?.user?.role);
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [target, setTarget] = useState(null);
  const [cash, setCash] = useState('');
  const [pos, setPos] = useState([]);
  const [requestId, setRequestId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deposit, setDeposit] = useState({ shiftId: '', amount: '', bankName: '', accountNumber: '' });
  const [voiding, setVoiding] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setDate(''); setData(null); }, [branchId]);

  const load = useCallback(async () => {
    if (!branchId) { setData(null); return; }
    try {
      setError('');
      const response = await fetch(`/api/admin/fuel/collections?branchId=${encodeURIComponent(branchId)}${date ? `&date=${date}` : ''}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not load collections');
      setData(result.data);
    } catch (e) { setError(e.message); }
  }, [branchId, date]);
  useEffect(() => { load(); }, [load]);

  const openCollection = (row) => {
    setTarget(row); setCash(''); setPos([]); setRequestId(crypto.randomUUID());
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/fuel/shift/${target.shiftId}/dispensers/${target.dispenserId}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashCollected: Math.round(Number(cash || 0) * 100),
          posEntries: pos.filter((p) => p.terminalId && p.amount).map((p) => ({ terminalId: p.terminalId, amount: Math.round(Number(p.amount) * 100) })),
          requestId }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Collection failed');
      toast.success('Collection recorded'); setTarget(null); setRequestId(null); load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };
  const saveDeposit = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch('/api/admin/deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, shiftId: deposit.shiftId, amount: Math.round(Number(deposit.amount) * 100), bankName: deposit.bankName, accountNumber: deposit.accountNumber }) });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Deposit failed');
      toast.success('Deposit submitted'); setDeposit({ shiftId: '', amount: '', bankName: '', accountNumber: '' }); load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };
  const voidCollection = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch(`/api/admin/fuel/collections/${voiding.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: voidReason }) });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Correction failed');
      toast.success('Collection corrected. Enter its replacement if needed.'); setVoiding(null); setVoidReason(''); load();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  if (!branchId) return <Card><EmptyState title="Choose a fuel branch" subtitle="Select a branch in the switcher to see its pump collections." /></Card>;
  return <div className="space-y-5">
    <PageHeader title="Pump Collections" subtitle="Supervisor sales, cashier handovers, and outstanding balances by pump" />
    <Card className="p-4"><Field label="Operating date"><input type="date" value={date || data?.date || todayInLagos()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field></Card>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!data ? <Loader /> : <>
      {data.byProduct.length > 0 && <Card className="p-4">
        <h2 className="font-semibold mb-2">Supervisor sales</h2>
        <div className="grid sm:grid-cols-3 gap-3">{data.byProduct.map((p) => <div key={p.product}>
          <p className="text-sm text-gray-500">{p.product}</p>
          <p className="font-medium">{p.litres.toLocaleString()} L · ₦{(p.expectedAmount / 100).toLocaleString()}</p>
        </div>)}</div>
      </Card>}
      {data.rows.some((row) => row.collections.length) && <Card className="p-4">
        <h2 className="font-semibold mb-2">Recent collections · {data.date}</h2>
        <div className="divide-y text-sm">{data.rows.flatMap((row) => row.collections.map((collection) => ({ ...collection, dispenserLabel: row.dispenserLabel, attendantName: row.attendantName })))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5).map((collection) =>
            <div key={collection.id} className={`flex justify-between gap-3 py-2 ${collection.voidedAt ? 'text-gray-400 line-through' : ''}`}>
              <span>{collection.dispenserLabel} · {collection.attendantName || 'Unassigned'} · Cash ₦{(collection.cashAmount / 100).toLocaleString()} · POS ₦{(collection.posAmount / 100).toLocaleString()}</span>
              <strong>₦{(collection.totalAmount / 100).toLocaleString()}</strong>
            </div>)}</div>
      </Card>}
      <Card className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-3">Pump / attendant</th><th className="p-3">Sale</th><th className="p-3">Collected</th><th className="p-3">Outstanding</th><th className="p-3">Handover history</th><th className="p-3" /></tr></thead>
        <tbody>{data.rows.map((row) => <tr key={`${row.shiftId}-${row.dispenserId}`} className="border-b align-top">
          <td className="p-3"><strong>{row.dispenserLabel}</strong><br />{row.attendantName || 'Unassigned'}<br /><span className="text-gray-500">{row.shiftLabel || 'Shift'} · {row.productName}</span></td>
          <td className="p-3">{row.litres == null ? 'No supervisor entry' : `${row.litres.toLocaleString()} L · ₦${(row.expectedAmount / 100).toLocaleString()}`}</td>
          <td className="p-3">₦{(row.collected / 100).toLocaleString()}</td>
          <td className="p-3">{row.collectionCoverage === 'unknown' ? 'Unknown (legacy)' : `₦${(row.outstanding / 100).toLocaleString()}`}</td>
          <td className="p-3">{row.collections.length ? row.collections.map((c) => <div key={c.id} className={c.voidedAt ? 'line-through text-gray-400' : ''}>
            {c.collectionType.replaceAll('_', ' ')}: ₦{(c.totalAmount / 100).toLocaleString()}{c.voidedAt ? ' (corrected)' : ''}
            {session?.user?.role === 'owner' && row.shiftStatus === 'open' && !c.voidedAt && <button onClick={() => { setVoiding(c); setVoidReason(''); }} className="ml-2 text-red-600 text-xs">Correct</button>}
          </div>) : 'None'}</td>
          <td className="p-3">{canCollect && row.collectionCoverage !== 'unknown' && row.litres > 0 && (row.shiftStatus === 'open' || (row.collections.length > 0 && row.outstanding > 0)) && <button onClick={() => openCollection(row)} className="text-brand-600 font-medium">{row.shiftStatus === 'closed' ? 'Settle' : 'Collect'}</button>}</td>
        </tr>)}</tbody>
      </table>{data.rows.length === 0 && <p className="p-4 text-gray-500">No shifts for this operating date.</p>}</Card>
      {canCollect && data.shifts.length > 0 && <Card className="p-4">
        <h2 className="font-semibold mb-1">Bank deposit for {data.date}</h2>
        <p className="text-sm text-gray-500 mb-4">Link a later deposit to its original operating shift. It will be reviewed by the owner.</p>
        <form onSubmit={saveDeposit} className="grid sm:grid-cols-5 gap-3 items-end">
          <Field label="Shift"><select required className={inputCls} value={deposit.shiftId} onChange={(e) => setDeposit({ ...deposit, shiftId: e.target.value })}>
            <option value="">Select shift</option>{data.shifts.map((s) => <option key={s.id} value={s.id}>{s.shiftLabel || new Date(s.openedAt).toLocaleTimeString()} ({s.status})</option>)}
          </select></Field>
          <Field label="Amount"><NumberInput required value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} /></Field>
          <Field label="Bank"><input required className={inputCls} value={deposit.bankName} onChange={(e) => setDeposit({ ...deposit, bankName: e.target.value })} /></Field>
          <Field label="Account number"><input required className={inputCls} value={deposit.accountNumber} onChange={(e) => setDeposit({ ...deposit, accountNumber: e.target.value })} /></Field>
          <button disabled={saving} className={btnPrimaryCls}>Record Deposit</button>
        </form>
        {data.deposits.length > 0 && <div className="mt-4 text-sm space-y-1">{data.deposits.map((d) => <p key={d.id}>₦{(d.amount / 100).toLocaleString()} · {d.bankName} · {d.status}</p>)}</div>}
      </Card>}
    </>}
    {target && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><Card className="p-5 w-full max-w-lg">
      <h2 className="font-semibold mb-1">{target.shiftStatus === 'closed' ? 'Settle balance' : 'Record collection'}</h2>
      <p className="text-sm text-gray-500 mb-4">Collecting from {target.attendantName || 'assigned attendant'} · {target.dispenserLabel}. Outstanding ₦{(target.outstanding / 100).toLocaleString()}.</p>
      <form onSubmit={save} className="space-y-4">
        <Field label="Cash"><NumberInput value={cash} onChange={(e) => setCash(e.target.value)} /></Field>
        <Field label="POS entries"><div className="space-y-2">{pos.map((item, index) => <div key={index} className="flex gap-2">
          <select className={inputCls} value={item.terminalId} onChange={(e) => setPos(pos.map((p, i) => i === index ? { ...p, terminalId: e.target.value } : p))}>
            <option value="">Terminal</option>{(data.terminals || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <NumberInput value={item.amount} onChange={(e) => setPos(pos.map((p, i) => i === index ? { ...p, amount: e.target.value } : p))} />
          <button type="button" onClick={() => setPos(pos.filter((_, i) => i !== index))}>Remove</button>
        </div>)}<button type="button" onClick={() => setPos([...pos, { terminalId: '', amount: '' }])} className="text-brand-600">Add POS entry</button></div></Field>
        <div className="flex gap-3"><button disabled={saving} className={btnPrimaryCls}>{saving ? 'Saving...' : 'Record collection'}</button><button type="button" onClick={() => setTarget(null)}>Cancel</button></div>
      </form>
    </Card></div>}
    {voiding && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><Card className="p-5 w-full max-w-md">
      <h2 className="font-semibold mb-2">Correct collection</h2>
      <p className="text-sm text-gray-500 mb-4">The original handover stays in history. Record a replacement after correcting it.</p>
      <form onSubmit={voidCollection} className="space-y-3">
        <Field label="Reason"><input required className={inputCls} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></Field>
        <div className="flex gap-3"><button disabled={saving} className={btnPrimaryCls}>Confirm Correction</button><button type="button" onClick={() => setVoiding(null)}>Cancel</button></div>
      </form>
    </Card></div>}
  </div>;
}
