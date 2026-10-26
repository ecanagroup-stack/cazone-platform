'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, EmptyState, Modal, FormButtons, Field, Tabs,
  inputCls, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls, StatusPill, ReportToolbar, NumberInput, BusinessDateField,
} from '@/components/ui';
import { formatMoney, formatDate, formatMinorMoney, minorUnitsToDecimal } from '@/lib/format';
import { todayLocalDate } from '@/lib/saleDates.mjs';
import { FuelDeliveryModal, FuelCorrectModal, fmtL } from './FuelOffload';

const TABS = [
  { key: 'deliveries', label: 'Deliveries' },
  { key: 'suppliers', label: 'Suppliers' },
];

// Suppliers only exist to be picked when recording a delivery, so it rides along as a tab here
// instead of its own sidebar entry — the full list/edit view is a click away, and the delivery
// form's own inline "+ New supplier" still covers the fast path.
export default function DeliveriesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';
  const activeTab = searchParams.get('tab') === 'suppliers' ? 'suppliers' : 'deliveries';

  const setTab = (key) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === 'deliveries') params.delete('tab'); else params.set('tab', key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div>
      <PageHeader title="Deliveries" subtitle="Stock received, and who it comes from" />
      <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      {activeTab === 'deliveries' ? <DeliveriesTab key={branchId} branchId={branchId} /> : <SuppliersTab />}
    </div>
  );
}

const blankDelivery = () => ({ mode: 'received', supplierId: '', newSupplierName: '', vehiclePlate: '', productId: '', quantity: '', costPerUnit: '', deliveryDate: todayLocalDate(), backdateOtp: '' });
const blankAssign = () => ({ vehiclePlate: '', driverName: '', driverPhone: '', date: todayLocalDate(), backdateOtp: '' });
const blankStage = () => ({ date: todayLocalDate(), backdateOtp: '', arrivalDate: '' }); // a loading / arrival date, with its back-dating code
const ALLOCATION_STATUS_COLOR = { pending: 'gray', assigned: 'blue', loaded: 'amber', arrived: 'green', closed: 'gray' };
const ALLOCATION_STATUS_LABEL = { pending: 'Pending', assigned: 'Assigned', loaded: 'Loaded', arrived: 'Arrived', closed: 'Closed (sold out)' };
const LOADING_HOURS_AGO = [
  { value: 0, label: 'Just now' }, { value: 1, label: '1 hour ago' }, { value: 2, label: '2 hours ago' },
  { value: 3, label: '3 hours ago' }, { value: 4, label: '4 hours ago' }, { value: 5, label: '5 hours ago' },
];

// A fuel branch's deliveries: the tanker, its driver, the tank(s) and the declared-vs-actual litres. A shortage is
// red, an excess amber; stock moved by the Actual column.
// The driver of a trip: what was recorded with it. Only a delivery from before drivers were snapshotted per trip
// (no shift) falls back to the tanker's registered driver.
const tripDriver = (d) => (d.shiftId
  ? { name: d.driverName, phone: d.driverPhone }
  : { name: d.driverName || d.vehicle?.driverName, phone: d.driverPhone || d.vehicle?.driverPhone });

function FuelDeliveriesTable({ deliveries, onCorrect, renderActions }) {
  return (
    <Card className="overflow-hidden">
      <div className={tableScrollCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Truck</th>
              <th className="px-4 py-3 text-left font-medium">Driver</th>
              <th className="px-4 py-3 text-left font-medium">Product</th>
              <th className="px-4 py-3 text-left font-medium">Tank(s)</th>
              <th className="px-4 py-3 text-right font-medium">Declared</th>
              <th className="px-4 py-3 text-right font-medium">Actual</th>
              <th className="px-4 py-3 text-right font-medium">Shortage / Excess</th>
              <th className="px-4 py-3 text-left font-medium">Supplier</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {deliveries.length === 0 && <EmptyRow colSpan={11} text="No deliveries recorded yet" />}
            {deliveries.map((d) => {
              const isAllocation = d.qtyRemaining != null;
              const tankList = d.tanks?.length ? d.tanks : d.tank ? [{ tankId: d.tank.id, tank: d.tank, offloaded: d.quantity }] : [];
              return (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(d.businessDate ? d.businessDate.slice(0, 10) : d.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{d.vehicle?.plateNumber || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {tripDriver(d).name || '—'}
                    {tripDriver(d).phone && <span className="block text-xs text-gray-400">{tripDriver(d).phone}</span>}
                  </td>
                  <td className="px-4 py-3">{d.product.name}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {tankList.length === 0 ? '—' : tankList.map((t) => (
                      <span key={t.tankId} className="block">{t.tank?.label}{tankList.length > 1 ? ` (${fmtL(t.offloaded)} L)` : ''}</span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right">{d.declaredLoad != null ? `${fmtL(d.declaredLoad)} L` : '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {fmtL(d.quantity)} {d.product.unit}
                    {isAllocation && (
                      <span className="block text-xs text-gray-400 font-normal">{d.qtyRemaining.toLocaleString()} left · {ALLOCATION_STATUS_LABEL[d.status]}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.declaredLoad == null ? <span className="text-gray-400">—</span>
                      : d.shortage > 0 ? <span className="font-medium text-red-700">−{fmtL(d.shortage)} L short</span>
                      : d.excess > 0 ? <span className="font-medium text-amber-700">+{fmtL(d.excess)} L excess</span>
                      : <span className="text-gray-400">Exact</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{d.supplier?.name || '—'}</td>
                  <td className="px-4 py-3 text-right">{formatMinorMoney(d.totalCost)}</td>
                  <td className="px-4 py-3 text-right">
                    {!isAllocation && <button onClick={() => onCorrect(d)} className={tableActionCls}>Correct</button>}
                    {renderActions(d)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DeliveriesTab({ branchId }) {
  const { data: session } = useSession();
  const [data, setData] = useState(null); // { deliveries, suppliers, products, onHand, tanks, vehicles, openShift }
  const [showModal, setShowModal] = useState(false);
  const [showFuelModal, setShowFuelModal] = useState(false);
  const [fuelResult, setFuelResult] = useState(null); // the offload just recorded, for the result banner
  const [correcting, setCorrecting] = useState(null); // a fuel delivery
  const [form, setForm] = useState(blankDelivery);
  const [submitting, setSubmitting] = useState(false);
  const [assignFor, setAssignFor] = useState(null); // delivery
  const [assignForm, setAssignForm] = useState(blankAssign);
  const [loadingFor, setLoadingFor] = useState(null); // delivery
  const [hoursAgo, setHoursAgo] = useState(0);
  const [loadingStage, setLoadingStage] = useState(blankStage);
  const [arriveFor, setArriveFor] = useState(null); // delivery
  const [arriveStage, setArriveStage] = useState(blankStage);

  const load = useCallback(async () => {
    if (!branchId) { setData(null); return; }
    const r = await fetch(`/api/admin/deliveries?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/deliveries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, ...form, costPerUnit: form.costPerUnit === '' ? null : Math.round(Number(form.costPerUnit) * 100),
        }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(form.mode === 'allocation' ? 'Allocation started' : 'Delivery recorded');
        setShowModal(false); setForm(blankDelivery()); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssign = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/deliveries/${assignFor.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assignForm),
      });
      const d = await r.json();
      if (d.success) { toast.success('Vehicle assigned'); setAssignFor(null); setAssignForm(blankAssign()); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoading = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/deliveries/${loadingFor.id}/loading`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoursAgo: loadingStage.date === todayLocalDate() ? hoursAgo : 0, date: loadingStage.date, arrivalDate: loadingStage.arrivalDate, backdateOtp: loadingStage.backdateOtp }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Marked loaded'); setLoadingFor(null); setHoursAgo(0); setLoadingStage(blankStage()); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleArrive = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/deliveries/${arriveFor.id}/arrive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: arriveStage.date, backdateOtp: arriveStage.backdateOtp }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Marked arrived'); setArriveFor(null); setArriveStage(blankStage()); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!branchId) {
    return <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to record and view its deliveries." /></Card>;
  }

  if (!data) return <Loader />;

  const { deliveries, suppliers, products, onHand, serviceType, openShift } = data;
  const isFuel = serviceType === 'fuel_station';
  const canAddTanker = ['owner', 'manager'].includes(session?.user?.role); // the Fuel > Trucks API's roles

  // An allocation's stage buttons (assign / mark loaded / mark arrived), shared by both tables.
  const renderActions = (d) => {
    if (d.qtyRemaining == null) return null;
    return (
      <>
        {d.status === 'pending' && <button onClick={() => { setAssignFor(d); setAssignForm(blankAssign()); }} className={tableActionCls}>Assign vehicle</button>}
        {d.status === 'assigned' && <button onClick={() => { setLoadingFor(d); setHoursAgo(0); setLoadingStage(blankStage()); }} className={tableActionCls}>Mark loaded</button>}
        {d.status === 'loaded' && <button onClick={() => { setArriveFor(d); setArriveStage(blankStage()); }} className={tableActionCls}>Mark arrived</button>}
      </>
    );
  };

  const fuelCsvColumns = [
    { key: 'createdAt', label: 'Date', value: (r) => formatDate(r.businessDate ? r.businessDate.slice(0, 10) : r.createdAt) },
    { key: 'vehicle.plateNumber', label: 'Truck' },
    { key: 'driverName', label: 'Driver', value: (r) => tripDriver(r).name || '' },
    { key: 'product.name', label: 'Product' },
    { key: 'tanks', label: 'Tanks', value: (r) => (r.tanks?.length ? r.tanks.map((t) => t.tank?.label).join(', ') : r.tank?.label || '') },
    { key: 'declaredLoad', label: 'Declared (L)' },
    { key: 'quantity', label: 'Actual (L)' },
    { key: 'shortage', label: 'Shortage (L)' },
    { key: 'excess', label: 'Excess (L)' },
    { key: 'supplier.name', label: 'Supplier' },
    { key: 'totalCost', label: 'Cost', value: (r) => minorUnitsToDecimal(r.totalCost) },
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <ReportToolbar
          title="Deliveries"
          csvFilename="deliveries"
          csvRows={deliveries}
          csvColumns={isFuel ? fuelCsvColumns : [
            { key: 'createdAt', label: 'Date', value: (r) => formatDate(r.businessDate ? r.businessDate.slice(0, 10) : r.createdAt) },
            { key: 'supplier.name', label: 'Supplier' },
            { key: 'product.name', label: 'Product' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'totalCost', label: 'Cost', value: (r) => minorUnitsToDecimal(r.totalCost) },
            { key: 'vehicle.plateNumber', label: 'Vehicle' },
            { key: 'status', label: 'Status', value: (r) => (r.qtyRemaining != null ? r.status : 'received') },
          ]}
        />
        {isFuel
          ? (
            <div className="flex gap-2">
              {/* A paid-for load not collected yet is still tracked as an allocation (stages below), not an offload. */}
              <button onClick={() => { setForm({ ...blankDelivery(), mode: 'allocation' }); setShowModal(true); }} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">Start Allocation</button>
              <button onClick={() => { setFuelResult(null); setShowFuelModal(true); }} disabled={!openShift} title={openShift ? undefined : 'Open a shift first'} className={`${btnPrimaryCls} disabled:opacity-50`}>Record Offload</button>
            </div>
          )
          : <button onClick={() => { setForm(blankDelivery()); setShowModal(true); }} className={btnPrimaryCls}>Record Delivery</button>}
      </div>

      {isFuel && !openShift && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded mb-4 text-sm">
          No shift is open at this branch. Open a shift before recording a fuel delivery; a past delivery goes through Historical Entries.
        </div>
      )}

      {fuelResult && (
        <div className={`px-4 py-4 rounded mb-4 text-sm border flex justify-between items-start gap-3 ${fuelResult.shortage > 0 ? 'bg-red-50 border-red-200 text-red-800' : fuelResult.excess > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          <div>
            <p className="font-semibold">Offload recorded{fuelResult.vehicle ? ` - ${fuelResult.vehicle.plateNumber}` : ''}.</p>
            <p className="mt-0.5">
              Declared {fmtL(fuelResult.declaredLoad)} L · Actual {fmtL(fuelResult.actualLitres)} L ·{' '}
              {fuelResult.shortage > 0 ? `Shortage ${fmtL(fuelResult.shortage)} L (reported to the oversight team)` : fuelResult.excess > 0 ? `Excess ${fmtL(fuelResult.excess)} L` : 'Exact match'}
            </p>
          </div>
          <button type="button" onClick={() => setFuelResult(null)} className="text-xs font-semibold shrink-0">Dismiss</button>
        </div>
      )}

      {products.length > 0 && (
        <Card className="p-4 mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">On Hand</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {products.map((p) => (
              <div key={p.id}>
                <p className="text-xs text-gray-500">{p.name}</p>
                <p className="text-lg font-bold">{(onHand[p.id] || 0).toLocaleString()} <span className="text-xs font-normal text-gray-400">{p.unit}</span></p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isFuel ? (
        <FuelDeliveriesTable deliveries={deliveries} onCorrect={setCorrecting} renderActions={renderActions} />
      ) : (
      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Supplier</th>
                <th className="px-4 py-3 text-left font-medium">Product</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
                <th className="px-4 py-3 text-left font-medium">Vehicle</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deliveries.length === 0 && <EmptyRow colSpan={8} text="No deliveries recorded yet" />}
              {deliveries.map((d) => {
                const isAllocation = d.qtyRemaining != null;
                return (
                  <tr key={d.id}>
                    <td className="px-4 py-3 text-gray-500">{formatDate(d.businessDate ? d.businessDate.slice(0, 10) : d.createdAt)}</td>
                    <td className="px-4 py-3 font-medium">{d.supplier?.name || '—'}</td>
                    <td className="px-4 py-3">{d.product.name}</td>
                    <td className="px-4 py-3 text-right">
                      {d.quantity.toLocaleString()} {d.product.unit}
                      {isAllocation && <span className="block text-xs text-gray-400">{d.qtyRemaining.toLocaleString()} left</span>}
                    </td>
                    <td className="px-4 py-3 text-right">{formatMinorMoney(d.totalCost)}</td>
                    <td className="px-4 py-3 text-gray-500">{d.vehicle?.plateNumber || '—'}</td>
                    <td className="px-4 py-3">
                      {isAllocation ? <StatusPill status={ALLOCATION_STATUS_LABEL[d.status]} color={ALLOCATION_STATUS_COLOR[d.status]} /> : <StatusPill status="Received" color="green" />}
                    </td>
                    <td className="px-4 py-3 text-right">{renderActions(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      {showFuelModal && (
        <FuelDeliveryModal
          open onClose={() => setShowFuelModal(false)} branchId={branchId} data={data} canAddTanker={canAddTanker} onReload={load}
          onSaved={(recorded) => {
            setShowFuelModal(false); setFuelResult(recorded); load();
            toast.success(recorded.shortage > 0 ? 'Offload recorded - shortage reported' : 'Offload recorded');
          }}
        />
      )}
      {correcting && <FuelCorrectModal delivery={correcting} onClose={() => setCorrecting(null)} onSaved={() => { setCorrecting(null); load(); }} />}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={isFuel ? 'Start Allocation' : 'Record Delivery'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isFuel && <Field label="When is this on hand?" required>
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={inputCls}>
              <option value="received">Received now — goes straight into stock</option>
              <option value="allocation">Paid for, not collected yet — track as an allocation</option>
            </select>
          </Field>}
          <Field label="Supplier" required>
            {suppliers.length > 0 ? (
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value, newSupplierName: '' })} className={inputCls}>
                <option value="">— New supplier —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <p className="text-xs text-gray-500 mb-2">No suppliers yet — name one below.</p>
            )}
            {!form.supplierId && (
                <input
                type="text" value={form.newSupplierName} onChange={(e) => setForm({ ...form, newSupplierName: e.target.value })}
                  className={`${inputCls} mt-2`} placeholder="Depot Name" required={!form.supplierId}
              />
            )}
          </Field>
          {form.mode === 'received' && (
            <Field label="Vehicle plate number">
              <input type="text" value={form.vehiclePlate} onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })} className={inputCls} placeholder="Optional" />
            </Field>
          )}
          <Field label="Product" required>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={inputCls} required>
              <option value="">Select...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={form.mode === 'allocation' ? 'Quantity paid for' : 'Quantity'} required>
              <NumberInput value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
            </Field>
            <Field label="Cost per unit (optional)">
              <NumberInput value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} />
            </Field>
          </div>
          <BusinessDateField
            label={form.mode === 'allocation' ? 'Date paid for' : 'Date received'} value={form.deliveryDate} onChange={(deliveryDate) => setForm({ ...form, deliveryDate })}
            otp={form.backdateOtp} onOtpChange={(backdateOtp) => setForm((f) => ({ ...f, backdateOtp }))}
          />
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel={form.mode === 'allocation' ? 'Start Allocation' : 'Record Delivery'} />
        </form>
      </Modal>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Assign Vehicle">
        <form onSubmit={handleAssign} className="space-y-4">
          <p className="text-sm text-gray-500">Which vehicle is going to collect this allocation?</p>
          <Field label="Vehicle plate number" required>
            <input type="text" value={assignForm.vehiclePlate} onChange={(e) => setAssignForm({ ...assignForm, vehiclePlate: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <Field label="Driver name">
            <input type="text" value={assignForm.driverName} onChange={(e) => setAssignForm({ ...assignForm, driverName: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Driver phone">
            <input type="text" value={assignForm.driverPhone} onChange={(e) => setAssignForm({ ...assignForm, driverPhone: e.target.value })} className={inputCls} />
          </Field>
          <BusinessDateField
            label="Date assigned" value={assignForm.date} onChange={(date) => setAssignForm({ ...assignForm, date })}
            otp={assignForm.backdateOtp} onOtpChange={(backdateOtp) => setAssignForm((f) => ({ ...f, backdateOtp }))}
          />
          <FormButtons onCancel={() => setAssignFor(null)} submitting={submitting} submitLabel="Assign" />
        </form>
      </Modal>

      <Modal open={!!loadingFor} onClose={() => setLoadingFor(null)} title="Mark Loaded">
        <form onSubmit={handleLoading} className="space-y-4">
          <p className="text-sm text-gray-500">When was it loaded? It'll be presumed arrived automatically 6 hours after loading if no one marks it arrived sooner.</p>
          <BusinessDateField
            label="Date loaded" value={loadingStage.date} onChange={(date) => setLoadingStage({ ...loadingStage, date })}
            otp={loadingStage.backdateOtp} onOtpChange={(backdateOtp) => setLoadingStage((s) => ({ ...s, backdateOtp }))}
          />
          {loadingStage.date === todayLocalDate() && (
            <Field label="Loaded" required>
              <select value={hoursAgo} onChange={(e) => setHoursAgo(Number(e.target.value))} className={inputCls}>
                {LOADING_HOURS_AGO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )}
          {loadingStage.date < todayLocalDate() && (
            <Field label="Date arrived (optional)">
              <input type="date" min={loadingStage.date} max={todayLocalDate()} value={loadingStage.arrivalDate} onChange={(e) => setLoadingStage({ ...loadingStage, arrivalDate: e.target.value })} className={inputCls} />
              <p className="text-xs text-gray-500 mt-1">Covered by the same code. Left blank, it is recorded as arrived 6 hours after loading.</p>
            </Field>
          )}
          <FormButtons onCancel={() => setLoadingFor(null)} submitting={submitting} submitLabel="Mark Loaded" />
        </form>
      </Modal>

      <Modal open={!!arriveFor} onClose={() => setArriveFor(null)} title="Mark Arrived">
        <form onSubmit={handleArrive} className="space-y-4">
          <BusinessDateField
            label="Date arrived" value={arriveStage.date} onChange={(date) => setArriveStage({ ...arriveStage, date })}
            otp={arriveStage.backdateOtp} onOtpChange={(backdateOtp) => setArriveStage((s) => ({ ...s, backdateOtp }))}
          />
          <FormButtons onCancel={() => setArriveFor(null)} submitting={submitting} submitLabel="Mark Arrived" />
        </form>
      </Modal>
    </div>
  );
}

const blankSupplier = { name: '', type: 'depot', phone: '', address: '' };

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankSupplier);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/suppliers');
    const d = await r.json();
    if (d.success) setSuppliers(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowModal(false); setForm(blankSupplier); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (s) => {
    const r = await fetch(`/api/admin/suppliers/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !s.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  if (!suppliers) return <Loader />;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => { setForm(blankSupplier); setShowModal(true); }} className={btnPrimaryCls}>Add Supplier</button>
      </div>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {suppliers.length === 0 && <EmptyRow colSpan={5} text="No suppliers yet" />}
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{s.type || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.phone || '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={s.isActive ? 'Active' : 'Inactive'} color={s.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleActive(s)} className={tableActionCls}>{s.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Supplier">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
              <option value="depot">Depot</option>
              <option value="quarry">Quarry</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Phone">
            <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Address">
            <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Supplier" />
        </form>
      </Modal>
    </div>
  );
}
