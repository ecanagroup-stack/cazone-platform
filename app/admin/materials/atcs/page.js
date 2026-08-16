'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyState, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill,
  btnPrimaryCls, tableActionCls, theadCls, tableScrollCls, NumberInput,
} from '@/components/ui';
import { formatDate } from '@/lib/format';

const STATUS_COLOR = { pending: 'blue', assigned: 'amber', loaded: 'green', arrived: 'green', closed: 'gray' };
const STATUS_SORT = { arrived: 0, loaded: 1, assigned: 2, pending: 3, closed: 4 };
const LOADING_HOURS_AGO = [
  { value: 0, label: 'Just now' }, { value: 1, label: '1 hour ago' }, { value: 2, label: '2 hours ago' },
  { value: 3, label: '3 hours ago' }, { value: 4, label: '4 hours ago' }, { value: 5, label: '5 hours ago' },
];

const formatAtcNumber = (atc) => `${atc.product?.abbreviation || '???'}-${atc.atcNumber}`;
const getStatusLabel = (atc) => atc.status[0].toUpperCase() + atc.status.slice(1);

const blankForm = { cementBrand: '', atcNumber: '', bagsPaidFor: '', notes: '' };

// Ported from ecana_shop-app's app/admin/atcs/page.js — status-tab-filtered view over the shared
// allocation lifecycle (lib/allocation.js), cement-framed. Assign/Loading/Arrive reuse the existing
// generic /api/admin/deliveries/[id]/{assign,loading,arrive} routes unchanged.
export default function AtcsPage() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';

  const [atcs, setAtcs] = useState(null);
  const [brands, setBrands] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const [assignFor, setAssignFor] = useState(null);
  const [selectedTruck, setSelectedTruck] = useState('');
  const [loadingFor, setLoadingFor] = useState(null);
  const [hoursAgo, setHoursAgo] = useState(0);

  const load = useCallback(async () => {
    if (!serviceId) { setAtcs(null); return; }
    const params = new URLSearchParams({ serviceId, ...(brandFilter ? { brand: brandFilter } : {}) });
    const [a, b, t] = await Promise.all([
      fetch(`/api/admin/materials/atcs?${params}`).then((r) => r.json()),
      fetch(`/api/admin/materials/cement-brands?serviceId=${serviceId}`).then((r) => r.json()),
      fetch('/api/admin/materials/trucks').then((r) => r.json()),
    ]);
    if (a.success) setAtcs(a.data); else toast.error(a.error || 'Failed to load');
    if (b.success) setBrands(b.data);
    if (t.success) setTrucks(t.data);
  }, [serviceId, brandFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = (statusFilter ? (atcs || []).filter((a) => a.status === statusFilter) : (atcs || []))
    .slice()
    .sort((x, y) => (STATUS_SORT[x.status] ?? 5) - (STATUS_SORT[y.status] ?? 5) || new Date(y.createdAt) - new Date(x.createdAt));
  const statusCounts = (atcs || []).reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/atcs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, branchId, bagsPaidFor: Number(form.bagsPaidFor) }),
      });
      const d = await r.json();
      if (d.success) { toast.success('ATC recorded'); setShowCreate(false); setForm(blankForm); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssign = async (e) => {
    e.preventDefault();
    if (!selectedTruck) return toast.error('Pick a truck');
    const truck = trucks.find((t) => t.id === selectedTruck);
    const r = await fetch(`/api/admin/deliveries/${assignFor.id}/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehiclePlate: truck.plateNumber, driverName: truck.driverName, driverPhone: truck.driverPhone }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Truck assigned'); setAssignFor(null); setSelectedTruck(''); load(); }
    else toast.error(d.error);
  };

  const handleLoading = async (e) => {
    e.preventDefault();
    const r = await fetch(`/api/admin/deliveries/${loadingFor.id}/loading`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hoursAgo }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Loading updated'); setLoadingFor(null); setHoursAgo(0); load(); }
    else toast.error(d.error);
  };

  const handleArrive = async (atc) => {
    const r = await fetch(`/api/admin/deliveries/${atc.id}/arrive`, { method: 'POST' });
    const d = await r.json();
    if (d.success) { toast.success('Marked arrived'); load(); }
    else toast.error(d.error);
  };

  if (!serviceId || !branchId) {
    return (
      <div>
        <PageHeader title="ATCs" subtitle="Authorization To Collect — cement stock tracking" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose Construction Material and a branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (!atcs) return <Loader />;

  return (
    <div>
      <PageHeader
        title="ATCs"
        subtitle="Authorization To Collect — cement stock tracking"
        action={
          brands.length === 0
            ? <span className="text-sm text-gray-500">Add a cement brand first</span>
            : <button onClick={() => { setForm(blankForm); setShowCreate(true); }} className={btnPrimaryCls}>Record ATC</button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="px-3 py-1.5 border rounded text-sm">
          <option value="">All Brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.attributes?.grade ? ` (${b.attributes.grade})` : ''}</option>)}
        </select>
      </div>

      <div className="mb-4 flex gap-2 flex-wrap">
        {['', 'pending', 'assigned', 'loaded', 'arrived', 'closed'].map((s) => {
          const count = s ? (statusCounts[s] || 0) : (atcs || []).length;
          return (
            <button
              key={s || 'all'} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-sm rounded border ${statusFilter === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white hover:bg-gray-50'}`}
            >
              {s ? s[0].toUpperCase() + s.slice(1) : 'All'} ({count})
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm min-w-[900px]">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">ATC #</th>
                <th className="px-3 py-3 text-left font-medium">Date</th>
                <th className="px-3 py-3 text-left font-medium">Assigned</th>
                <th className="px-4 py-3 text-right font-medium">Remaining</th>
                <th className="px-3 py-3 text-left font-medium">Supplied / Ref</th>
                <th className="px-3 py-3 text-left font-medium">Truck</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 && <EmptyRow colSpan={8} text="No ATCs" />}
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-medium">{formatAtcNumber(a)}</td>
                  <td className="px-3 py-3 text-gray-500">{formatDate(a.createdAt)}</td>
                  <td className="px-3 py-3 text-gray-500">{a.assignedAt ? formatDate(a.assignedAt) : '—'}</td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{a.qtyRemaining.toLocaleString()}/{a.quantity.toLocaleString()}</td>
                  <td className="px-3 py-3 align-top">
                    {a.supplies.length > 0 ? (
                      <div className="space-y-1 text-xs">
                        {a.supplies.map((s, i) => <div key={i}>{s.qtySupplied.toLocaleString()} — {s.reference}</div>)}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 text-gray-500">{a.vehicle?.plateNumber || '—'}</td>
                  <td className="px-3 py-3"><StatusPill status={getStatusLabel(a)} color={STATUS_COLOR[a.status]} /></td>
                  <td className="px-3 py-3 text-right">
                    {a.status === 'pending' && !a.vehicleId && (
                      <button onClick={() => { setAssignFor(a); setSelectedTruck(''); }} className={`${tableActionCls} mr-3`}>Assign Truck</button>
                    )}
                    {a.status === 'assigned' && (
                      <>
                        <button onClick={() => { setAssignFor(a); setSelectedTruck(''); }} className={`${tableActionCls} mr-3`}>Reassign</button>
                        <button onClick={() => { setLoadingFor(a); setHoursAgo(0); }} className={`${tableActionCls} mr-3`}>Loading</button>
                      </>
                    )}
                    {a.status === 'loaded' && (
                      <button onClick={() => handleArrive(a)} className={tableActionCls}>Mark Arrived</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Record ATC">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Cement Brand" required>
            <select value={form.cementBrand} onChange={(e) => setForm({ ...form, cementBrand: e.target.value })} className={inputCls} required>
              <option value="">— Select brand —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.attributes?.grade ? ` (${b.attributes.grade})` : ''}</option>)}
            </select>
          </Field>
          <Field label="ATC Number" required>
            <div className="space-y-2">
              <input type="text" value={form.atcNumber} onChange={(e) => setForm({ ...form, atcNumber: e.target.value })} className={inputCls} placeholder="e.g., 001, 0042, 1500" required />
              {form.cementBrand && form.atcNumber && (
                <p className="text-sm text-gray-600">
                  Final ATC: <span className="font-bold text-gray-900">{brands.find((b) => b.id === form.cementBrand)?.abbreviation || 'N/A'}-{form.atcNumber}</span>
                </p>
              )}
              <p className="text-xs text-gray-500">Enter the number only — the brand abbreviation is added automatically.</p>
            </div>
          </Field>
          <Field label="Quantity in Bags" required>
            <NumberInput value={form.bagsPaidFor} onChange={(e) => setForm({ ...form, bagsPaidFor: e.target.value })} required />
          </Field>
          <Field label="Notes">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} rows={2} />
          </Field>
          <FormButtons onCancel={() => setShowCreate(false)} submitting={submitting} submitLabel="Record ATC" />
        </form>
      </Modal>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Assign Truck">
        {assignFor && (
          <form onSubmit={handleAssign} className="space-y-4">
            <div className="bg-gray-50 p-3 rounded text-sm">
              <p><span className="text-gray-500">ATC:</span> <span className="font-medium">{formatAtcNumber(assignFor)}</span></p>
              <p><span className="text-gray-500">Bags remaining:</span> <span className="font-medium">{assignFor.qtyRemaining.toLocaleString()}</span></p>
            </div>
            <Field label="Truck" required>
              <select value={selectedTruck} onChange={(e) => setSelectedTruck(e.target.value)} className={inputCls} required>
                <option value="">— Select truck —</option>
                {trucks.filter((t) => t.type === 'cement').map((t) => (
                  <option key={t.id} value={t.id} disabled={t.busy}>
                    {t.plateNumber} — {t.driverName}{t.busy ? ` (${t.busyReason})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <FormButtons onCancel={() => setAssignFor(null)} submitLabel="Assign" />
          </form>
        )}
      </Modal>

      <Modal open={!!loadingFor} onClose={() => setLoadingFor(null)} title="Loading">
        {loadingFor && (
          <form onSubmit={handleLoading} className="space-y-4">
            <div className="bg-gray-50 p-3 rounded text-sm space-y-1">
              <p><span className="text-gray-500">ATC:</span> <span className="font-medium">{formatAtcNumber(loadingFor)}</span></p>
              <p><span className="text-gray-500">Truck:</span> <span className="font-medium">{loadingFor.vehicle?.plateNumber || '—'}</span></p>
              <p><span className="text-gray-500">Remaining:</span> <span className="font-medium">{loadingFor.qtyRemaining.toLocaleString()}/{loadingFor.quantity.toLocaleString()}</span></p>
            </div>
            <Field label="Loaded" required>
              <select value={hoursAgo} onChange={(e) => setHoursAgo(Number(e.target.value))} className={inputCls}>
                {LOADING_HOURS_AGO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <FormButtons onCancel={() => setLoadingFor(null)} submitLabel="Save Loading" />
          </form>
        )}
      </Modal>
    </div>
  );
}
