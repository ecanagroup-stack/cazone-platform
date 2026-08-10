'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, Modal, FormButtons, Field, inputCls, btnPrimaryCls, tableActionCls, StatusPill } from '@/components/ui';
import { formatDate } from '@/lib/format';

const blankTank = { label: '', capacity: '', productId: '', newProductName: '' };
const blankDispenser = { label: '' };

export default function TanksPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';

  const [data, setData] = useState(null); // { tanks, products }
  const [showTankModal, setShowTankModal] = useState(false);
  const [tankForm, setTankForm] = useState(blankTank);
  const [addDispenserFor, setAddDispenserFor] = useState(null); // tank object
  const [dispenserForm, setDispenserForm] = useState(blankDispenser);
  const [submitting, setSubmitting] = useState(false);

  const [dipFor, setDipFor] = useState(null); // tank object
  const [measured, setMeasured] = useState('');
  const [dipResult, setDipResult] = useState(null);

  const load = useCallback(async () => {
    if (!branchId) { setData(null); return; }
    const r = await fetch(`/api/admin/fuel/tanks?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleAddTank = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/tanks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, ...tankForm }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Tank added'); setShowTankModal(false); setTankForm(blankTank); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddDispenser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/dispensers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tankId: addDispenserFor.id, ...dispenserForm }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Dispenser added'); setAddDispenserFor(null); setDispenserForm(blankDispenser); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTank = async (tank) => {
    const r = await fetch(`/api/admin/fuel/tanks/${tank.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !tank.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  const toggleDispenser = async (dispenser) => {
    const r = await fetch(`/api/admin/fuel/dispensers/${dispenser.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !dispenser.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  const handleRecordDip = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/tanks/${dipFor.id}/reconcile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ measured: Number(measured) }),
      });
      const d = await r.json();
      if (d.success) {
        setDipResult(d.data);
        toast[d.data.status === 'exception' ? 'error' : 'success'](
          d.data.status === 'exception' ? `Variance of ${d.data.variance.toFixed(1)}L flagged for review` : 'Within tolerance'
        );
        load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const closeDipModal = () => { setDipFor(null); setMeasured(''); setDipResult(null); };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Tanks & Dispensers" subtitle="Set up per branch" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to see and manage its tanks and dispensers." /></Card>
      </div>
    );
  }

  if (!data) return <Loader />;

  const { tanks, products } = data;

  return (
    <div>
      <PageHeader
        title="Tanks & Dispensers"
        subtitle="This branch's fuel storage and pumps"
        action={<button onClick={() => { setTankForm(blankTank); setShowTankModal(true); }} className={btnPrimaryCls}>Add Tank</button>}
      />

      <div className="space-y-6">
        {tanks.length === 0 && <Card className="p-6 text-center text-sm text-gray-500">No tanks yet — add one to get started.</Card>}
        {tanks.map((tank) => (
          <Card key={tank.id} className="overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">
                  {tank.label} <span className="text-xs text-gray-400 font-normal">— {tank.product.name}, {tank.capacity.toLocaleString()} L capacity</span>
                </p>
                <p className="text-xs text-gray-500">
                  {tank.dispensers.length} dispenser{tank.dispensers.length === 1 ? '' : 's'} · <span className="font-medium text-gray-700">{tank.onHand.toLocaleString()} L on hand (book)</span>
                </p>
                {tank.lastReconciliation && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Last dip {formatDate(tank.lastReconciliation.periodEnd)}: {tank.lastReconciliation.measured.toLocaleString()} L
                    {tank.lastReconciliation.status === 'exception' && <span className="text-amber-700 font-medium"> — variance flagged</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusPill status={tank.isActive ? 'Active' : 'Inactive'} color={tank.isActive ? 'green' : 'gray'} />
                <button onClick={() => { setDipFor(tank); setMeasured(''); setDipResult(null); }} className={tableActionCls}>Record Dip</button>
                <button onClick={() => toggleTank(tank)} className={tableActionCls}>{tank.isActive ? 'Deactivate' : 'Reactivate'}</button>
                <button onClick={() => { setAddDispenserFor(tank); setDispenserForm(blankDispenser); }} className={tableActionCls}>+ Add Dispenser</button>
              </div>
            </div>
            <div className="divide-y">
              {tank.dispensers.length === 0 && <p className="px-4 py-4 text-sm text-gray-500">No dispensers yet.</p>}
              {tank.dispensers.map((d) => (
                <div key={d.id} className="px-4 py-3 flex items-center justify-between">
                  <p className="text-sm font-medium">{d.label}</p>
                  <div className="flex items-center gap-3">
                    <StatusPill status={d.isActive ? 'Active' : 'Inactive'} color={d.isActive ? 'green' : 'gray'} />
                    <button onClick={() => toggleDispenser(d)} className={tableActionCls}>{d.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={showTankModal} onClose={() => setShowTankModal(false)} title="Add Tank">
        <form onSubmit={handleAddTank} className="space-y-4">
          <Field label="Tank label" required>
            <input type="text" value={tankForm.label} onChange={(e) => setTankForm({ ...tankForm, label: e.target.value })} className={inputCls} required autoFocus placeholder="e.g., Tank 1" />
          </Field>
          <Field label="Capacity (litres)" required>
            <input type="number" min="1" value={tankForm.capacity} onChange={(e) => setTankForm({ ...tankForm, capacity: e.target.value })} className={inputCls} required />
          </Field>
          <Field label="Product" required>
            {products.length > 0 ? (
              <select
                value={tankForm.productId}
                onChange={(e) => setTankForm({ ...tankForm, productId: e.target.value, newProductName: '' })}
                className={inputCls}
              >
                <option value="">— New product —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <p className="text-xs text-gray-500 mb-2">No products yet — name one below.</p>
            )}
            {!tankForm.productId && (
              <input
                type="text" value={tankForm.newProductName} onChange={(e) => setTankForm({ ...tankForm, newProductName: e.target.value })}
                className={`${inputCls} mt-2`} placeholder="e.g., PMS (Petrol)" required={!tankForm.productId}
              />
            )}
          </Field>
          <FormButtons onCancel={() => setShowTankModal(false)} submitting={submitting} submitLabel="Add Tank" />
        </form>
      </Modal>

      <Modal open={!!addDispenserFor} onClose={() => setAddDispenserFor(null)} title={`Add dispenser to ${addDispenserFor?.label || ''}`}>
        <form onSubmit={handleAddDispenser} className="space-y-4">
          <Field label="Dispenser label" required>
            <input type="text" value={dispenserForm.label} onChange={(e) => setDispenserForm({ label: e.target.value })} className={inputCls} required autoFocus placeholder="e.g., Pump 1" />
          </Field>
          <FormButtons onCancel={() => setAddDispenserFor(null)} submitting={submitting} submitLabel="Add Dispenser" />
        </form>
      </Modal>

      <Modal open={!!dipFor} onClose={closeDipModal} title={`Record Dip — ${dipFor?.label || ''}`}>
        {dipResult ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-500">Book stock</p><p className="font-medium">{dipResult.book.toLocaleString()} L</p></div>
              <div><p className="text-xs text-gray-500">Measured</p><p className="font-medium">{dipResult.measured.toLocaleString()} L</p></div>
              <div><p className="text-xs text-gray-500">Variance</p><p className={`font-medium ${dipResult.status === 'exception' ? 'text-amber-700' : ''}`}>{dipResult.variance > 0 ? '+' : ''}{dipResult.variance.toFixed(1)} L ({dipResult.variancePct.toFixed(2)}%)</p></div>
              <div><p className="text-xs text-gray-500">Status</p><p className="font-medium capitalize">{dipResult.status.replace('_', ' ')}</p></div>
            </div>
            {dipResult.status === 'exception' && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                This is outside the {dipResult.tolerance}% tolerance and has been added to Anything Wrong for a manager to acknowledge.
              </p>
            )}
            <button onClick={closeDipModal} className={`w-full ${btnPrimaryCls}`}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleRecordDip} className="space-y-4">
            <p className="text-sm text-gray-500">Enter the physical dip reading in litres — compared against book stock since the last dip.</p>
            <Field label="Measured (litres)" required>
              <input type="number" step="0.01" min="0" value={measured} onChange={(e) => setMeasured(e.target.value)} className={inputCls} required autoFocus />
            </Field>
            <FormButtons onCancel={closeDipModal} submitting={submitting} submitLabel="Record Dip" />
          </form>
        )}
      </Modal>
    </div>
  );
}
