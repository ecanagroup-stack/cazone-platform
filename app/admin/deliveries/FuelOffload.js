'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, Field, FormButtons, NumberInput, inputCls } from '@/components/ui';
import { formatDate } from '@/lib/format';

// The fuel branches' Truck Offload — petrol-station-app's manager/stock page ported. The request body is the one
// POST /api/admin/deliveries reads for a fuel branch (recordFuelDelivery): a registered tanker, the declared
// waybill load, and the ACTUAL litres from per-tank dips or one typed figure. Stock goes up by the actual litres.

const round3 = (n) => Math.round(n * 1000) / 1000;
const num = (value) => (value === '' || value == null ? NaN : Number(value));
export const fmtL = (n) => Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 3 });

// actual - declared, as the shortage / excess the reports quote (null until both figures are in).
function variance(declared, actual) {
  if (!(declared > 0) || !(actual > 0)) return null;
  const v = round3(actual - declared);
  return { variance: v, shortage: v < 0 ? -v : 0, excess: v > 0 ? v : 0 };
}

function VarianceSummary({ declared, actual, actualLabel }) {
  const v = variance(declared, actual);
  const tone = !v ? 'bg-gray-50 border-gray-200' : v.shortage > 0 ? 'bg-red-50 border-red-200' : v.excess > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200';
  return (
    <div className={`px-4 py-3 rounded border text-sm space-y-1 ${tone}`}>
      <div className="flex justify-between gap-2"><span className="text-gray-600">Declared load (waybill)</span><span className="font-semibold">{declared > 0 ? `${fmtL(declared)} L` : '—'}</span></div>
      <div className="flex justify-between gap-2"><span className="text-gray-600">{actualLabel}</span><span className="font-semibold">{actual > 0 ? `${fmtL(actual)} L` : '—'}</span></div>
      <div className="flex justify-between gap-2 pt-1.5 mt-1.5 border-t border-black/5 font-bold">
        <span>{v?.shortage > 0 ? 'Shortage' : v?.excess > 0 ? 'Excess' : 'Variance'}</span>
        <span className={v?.shortage > 0 ? 'text-red-700' : v?.excess > 0 ? 'text-amber-700' : v ? 'text-green-700' : 'text-gray-400'}>
          {!v ? '—' : v.variance === 0 ? 'Exact match' : `${v.variance < 0 ? '−' : '+'}${fmtL(Math.abs(v.variance))} L`}
        </span>
      </div>
    </div>
  );
}

const blankFuelForm = (products) => ({
  vehicleId: '', driverName: '', driverPhone: '', productId: products[0]?.id || '', declaredLoad: '',
  measure: 'dips', actualLitres: '', tankId: '', supplierId: '', newSupplierName: '', totalCost: '', notes: '',
});
const NEW_SUPPLIER = '__new';
const blankTanker = { plateNumber: '', driverName: '', driverPhone: '', capacity: '', ownership: 'own' };

// `data` is the deliveries GET payload ({ products, tanks, vehicles, suppliers, openShift }); `onSaved` gets the
// recorded delivery (with its shortage / excess split); `onReload` refreshes `data` (after a tanker is added).
export function FuelDeliveryModal({ open, onClose, branchId, data, canAddTanker, onSaved, onReload }) {
  const { products, tanks, vehicles, suppliers, openShift } = data;
  const [form, setForm] = useState(() => blankFuelForm(products));
  const [dips, setDips] = useState({}); // tankId -> { opening, closing }
  const [submitting, setSubmitting] = useState(false);
  const [tankerForm, setTankerForm] = useState(null); // the "add a tanker" mini form, when open
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const vehicle = vehicles.find((v) => v.id === form.vehicleId);
  const tanksForProduct = tanks.filter((t) => t.productId === form.productId);
  const useDips = form.measure === 'dips' && tanksForProduct.length > 0;
  const typedTankId = form.tankId || (tanksForProduct.length === 1 ? tanksForProduct[0].id : '');

  const rows = tanksForProduct.map((tank) => {
    const d = dips[tank.id] || {};
    const opening = num(d.opening);
    const closing = num(d.closing);
    const offloaded = Number.isFinite(opening) && Number.isFinite(closing) ? round3(closing - opening) : null;
    const hasOpening = (d.opening ?? '') !== '';
    const hasClosing = (d.closing ?? '') !== '';
    return { tank, opening: d.opening ?? '', closing: d.closing ?? '', offloaded, partial: hasOpening !== hasClosing };
  });
  const declared = num(form.declaredLoad);
  const actual = useDips ? round3(rows.reduce((sum, r) => sum + (r.offloaded > 0 ? r.offloaded : 0), 0)) : num(form.actualLitres);

  const pickTanker = (vehicleId) => {
    const v = vehicles.find((x) => x.id === vehicleId);
    set({ vehicleId, driverName: v?.driverName || '', driverPhone: v?.driverPhone || '' });
  };

  const saveTanker = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/trucks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tankerForm) });
      const d = await r.json();
      if (!d.success) { toast.error(d.error || 'Could not add the tanker'); return; }
      toast.success(`${d.data.plateNumber} added`);
      await onReload();
      set({ vehicleId: d.data.id, driverName: d.data.driverName || '', driverPhone: d.data.driverPhone || '' });
      setTankerForm(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!openShift) return toast.error('Open a shift before recording a fuel delivery');
    if (!form.vehicleId) return toast.error('Select the delivering tanker');
    if (!(declared > 0)) return toast.error('Enter the declared load (litres on the depot waybill)');

    let measured;
    if (useDips) {
      const bad = rows.find((r) => r.partial || (r.offloaded != null && r.offloaded < 0));
      if (bad) return toast.error(bad.partial ? `${bad.tank.label}: enter both the opening and the closing dip` : `${bad.tank.label}: closing dip is lower than the opening dip`);
      const filled = rows.filter((r) => r.offloaded != null);
      if (filled.length === 0) return toast.error('Enter the opening and closing dip for at least one tank');
      if (!(actual > 0)) return toast.error('Nothing was offloaded - check the closing dip readings');
      measured = { tanks: filled.map((r) => ({ tankId: r.tank.id, openingDip: num(r.opening), closingDip: num(r.closing) })) };
    } else {
      if (!(actual > 0)) return toast.error('Enter the actual litres discharged');
      measured = { actualLitres: actual, tankId: typedTankId || undefined };
    }

    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/deliveries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, productId: form.productId, vehicleId: form.vehicleId,
          driverName: form.driverName, driverPhone: form.driverPhone, declaredLoad: declared, ...measured,
          supplierId: form.supplierId && form.supplierId !== NEW_SUPPLIER ? form.supplierId : undefined,
          newSupplierName: form.supplierId === NEW_SUPPLIER ? form.newSupplierName : undefined,
          totalCost: form.totalCost === '' ? null : Math.round(Number(form.totalCost) * 100), // naira -> kobo
          notes: form.notes,
        }),
      });
      const d = await r.json();
      if (d.success) onSaved(d.data);
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const product = products.find((p) => p.id === form.productId);

  return (
    <>
      <Modal open={open} onClose={onClose} title="Truck Offload" size="xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {!openShift ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded text-sm">
              No shift is open at this branch. Open a shift before recording a delivery; a past delivery goes through Historical Entries.
            </div>
          ) : (
            <p className="text-xs text-gray-500">Recorded against the running shift ({formatDate(openShift.operatingDate)}). Stock goes up by the litres actually discharged, not the declared load.</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Truck" required>
              <select value={form.vehicleId} onChange={(e) => pickTanker(e.target.value)} className={inputCls} required>
                <option value="">{vehicles.length ? 'Select truck...' : 'No tanker registered'}</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
              </select>
              {canAddTanker
                ? <button type="button" onClick={() => setTankerForm({ ...blankTanker })} className="text-xs font-semibold text-brand-700 mt-1">+ Add a tanker</button>
                : vehicles.length === 0 && <p className="text-xs text-amber-700 mt-1">Ask an owner or manager to register the tanker under Fuel &gt; Trucks.</p>}
            </Field>
            <Field label="Product" required>
              <select value={form.productId} onChange={(e) => { set({ productId: e.target.value, tankId: '' }); setDips({}); }} className={inputCls} required>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Driver name">
              <input type="text" value={form.driverName} onChange={(e) => set({ driverName: e.target.value })} className={inputCls} placeholder="Driver for this trip" />
            </Field>
            <Field label="Driver phone">
              <input type="text" value={form.driverPhone} onChange={(e) => set({ driverPhone: e.target.value })} className={inputCls} placeholder="080..." />
            </Field>
            <Field label="Declared load (L)" required>
              <NumberInput value={form.declaredLoad} onChange={(e) => set({ declaredLoad: e.target.value })} placeholder="From depot waybill" required />
              {vehicle?.capacity > 0 && (
                <p className={`text-xs mt-1 ${declared > vehicle.capacity ? 'text-amber-700' : 'text-gray-400'}`}>
                  Tanker capacity {fmtL(vehicle.capacity)} L{declared > vehicle.capacity ? ' - the declared load is above it' : ''}
                </p>
              )}
            </Field>
            <Field label="Total cost (₦, optional)">
              <NumberInput value={form.totalCost} onChange={(e) => set({ totalCost: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Supplier (optional)">
              <select value={form.supplierId} onChange={(e) => set({ supplierId: e.target.value, newSupplierName: '' })} className={inputCls}>
                <option value="">None</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={NEW_SUPPLIER}>+ New supplier</option>
              </select>
              {form.supplierId === NEW_SUPPLIER && (
                <input type="text" value={form.newSupplierName} onChange={(e) => set({ newSupplierName: e.target.value })} className={`${inputCls} mt-2`} placeholder="Depot / supplier name" required />
              )}
            </Field>
            <Field label="Notes">
              <input type="text" value={form.notes} onChange={(e) => set({ notes: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <div className="border rounded p-3 space-y-3">
            <p className="text-sm font-semibold">How much was discharged into the {product?.name || 'product'} tanks?</p>
            {tanksForProduct.length > 0 ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="measure" checked={useDips} onChange={() => set({ measure: 'dips' })} /> Measure with tank dips</label>
                <label className="flex items-center gap-2"><input type="radio" name="measure" checked={!useDips} onChange={() => set({ measure: 'typed' })} /> No dips - type the litres</label>
              </div>
            ) : (
              <p className="text-xs text-amber-700">No active tank holds {product?.name || 'this product'} at this branch, so type the litres discharged below.</p>
            )}

            {useDips ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Take a fresh opening dip before the pour. Fill in every tank that received fuel and leave the others blank.</p>
                {rows.map((r) => (
                  <div key={r.tank.id} className="border rounded p-3">
                    <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                      <p className="text-sm font-semibold">{r.tank.label}</p>
                      <p className="text-xs text-gray-500">
                        Last closing dip: {r.tank.lastDip != null ? `${fmtL(r.tank.lastDip)} L${r.tank.lastDipAt ? ` (${formatDate(r.tank.lastDipAt)})` : ''}` : '—'} · capacity {fmtL(r.tank.capacity)} L
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-end">
                      <Field label="Opening dip (L)">
                        <NumberInput value={r.opening} placeholder="Before pour" onChange={(e) => setDips((p) => ({ ...p, [r.tank.id]: { ...p[r.tank.id], opening: e.target.value } }))} />
                      </Field>
                      <Field label="Closing dip (L)">
                        <NumberInput value={r.closing} placeholder="After pour" onChange={(e) => setDips((p) => ({ ...p, [r.tank.id]: { ...p[r.tank.id], closing: e.target.value } }))} />
                      </Field>
                      <div className="pb-2">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Offloaded</p>
                        <p className={`text-sm font-semibold ${r.offloaded < 0 ? 'text-red-700' : r.offloaded > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{r.offloaded != null ? `${fmtL(r.offloaded)} L` : '—'}</p>
                      </div>
                    </div>
                    {r.offloaded < 0 && <p className="text-xs text-red-700 mt-1">Closing dip is lower than the opening dip - check the readings.</p>}
                    {r.tank.capacity > 0 && num(r.closing) > r.tank.capacity && <p className="text-xs text-amber-700 mt-1">Closing dip is above the tank capacity.</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Actual litres discharged" required>
                  <NumberInput value={form.actualLitres} onChange={(e) => set({ actualLitres: e.target.value })} placeholder="What really went into the tank" required />
                  <p className="text-xs text-gray-500 mt-1">Use this when the tank cannot be dipped. Type the litres that were really received, for example when the driver delivered short of the waybill.</p>
                </Field>
                {tanksForProduct.length > 0 && (
                  <Field label="Receiving tank">
                    <select value={typedTankId} onChange={(e) => set({ tankId: e.target.value })} className={inputCls}>
                      <option value="">Not specified</option>
                      {tanksForProduct.map((t) => <option key={t.id} value={t.id}>{t.label}{t.lastDip != null ? ` (last dip ${fmtL(t.lastDip)} L)` : ''}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            )}
          </div>

          <VarianceSummary declared={declared} actual={actual} actualLabel={useDips ? 'Actual litres discharged (sum of dips)' : 'Actual litres discharged'} />

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={submitting || !openShift || vehicles.length === 0} className="flex-1 px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
              {submitting ? 'Recording...' : 'Record Offload'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!tankerForm} onClose={() => setTankerForm(null)} title="Add Tanker">
        {tankerForm && (
          <form onSubmit={saveTanker} className="space-y-4">
            <Field label="Plate number" required>
              <input type="text" value={tankerForm.plateNumber} onChange={(e) => setTankerForm({ ...tankerForm, plateNumber: e.target.value })} className={inputCls} required autoFocus />
            </Field>
            <Field label="Driver name" required>
              <input type="text" value={tankerForm.driverName} onChange={(e) => setTankerForm({ ...tankerForm, driverName: e.target.value })} className={inputCls} required />
            </Field>
            <Field label="Driver phone">
              <input type="text" value={tankerForm.driverPhone} onChange={(e) => setTankerForm({ ...tankerForm, driverPhone: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Capacity (litres, optional)">
              <NumberInput value={tankerForm.capacity} onChange={(e) => setTankerForm({ ...tankerForm, capacity: e.target.value })} />
            </Field>
            <Field label="Ownership" required>
              <select value={tankerForm.ownership} onChange={(e) => setTankerForm({ ...tankerForm, ownership: e.target.value })} className={inputCls}>
                <option value="own">Own truck</option>
                <option value="supplier">Supplier truck</option>
              </select>
            </Field>
            <FormButtons onCancel={() => setTankerForm(null)} submitting={submitting} submitLabel="Add Tanker" />
          </form>
        )}
      </Modal>
    </>
  );
}

// Correct a received fuel delivery: the actual litres (split per tank when it went into several), and the cost per
// litre. Posts to /api/admin/deliveries/[id]/correct, which re-derives the shortage against the declared load.
export function FuelCorrectModal({ delivery, onClose, onSaved }) {
  const multi = delivery.tanks?.length > 1;
  const [quantity, setQuantity] = useState(String(delivery.quantity));
  const [perTank, setPerTank] = useState(() => Object.fromEntries((delivery.tanks || []).map((t) => [t.tankId, String(t.offloaded)])));
  const [costPerUnit, setCostPerUnit] = useState(delivery.costPerUnit == null ? '' : String(delivery.costPerUnit / 100));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const actual = multi ? round3(Object.values(perTank).reduce((sum, v) => sum + (num(v) || 0), 0)) : num(quantity);
  const costChanged = costPerUnit !== (delivery.costPerUnit == null ? '' : String(delivery.costPerUnit / 100));

  const submit = async (e) => {
    e.preventDefault();
    if (!(actual > 0)) return toast.error('Enter the corrected litres');
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/deliveries/${delivery.id}/correct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: actual, reason,
          // Left alone, the stored total cost is kept (and rescaled with the litres) rather than rederived.
          ...(costChanged ? { costPerUnit: costPerUnit === '' ? null : Math.round(Number(costPerUnit) * 100) } : {}),
          ...(multi ? { tanks: delivery.tanks.map((t) => ({ tankId: t.tankId, offloaded: num(perTank[t.tankId]) || 0 })) } : {}),
        }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Delivery corrected'); onSaved(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Correct Delivery">
      <form onSubmit={submit} className="space-y-4">
        {multi ? delivery.tanks.map((t) => (
          <Field key={t.tankId} label={`${t.tank?.label || 'Tank'} - litres received`} required>
            <NumberInput value={perTank[t.tankId]} onChange={(e) => setPerTank({ ...perTank, [t.tankId]: e.target.value })} required />
          </Field>
        )) : (
          <Field label="Actual litres received" required>
            <NumberInput value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
        )}
        <Field label="Cost per litre (₦)">
          <NumberInput value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} />
        </Field>
        {delivery.declaredLoad != null && <VarianceSummary declared={delivery.declaredLoad} actual={actual} actualLabel="Actual litres received" />}
        <Field label="Reason for correction" required>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} required placeholder="Why is this being corrected?" />
        </Field>
        <FormButtons onCancel={onClose} submitting={submitting} submitLabel="Correct Delivery" />
      </form>
    </Modal>
  );
}
