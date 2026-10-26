'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Card, EmptyRow, EmptyState, Field, FormButtons, Loader, Modal, NumberInput, PageHeader, PasswordInput, StatusPill,
  btnPrimaryCls, inputCls, tableActionCls, tableDangerActionCls, tableScrollCls, theadCls,
} from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';

const STATUS_COLOR = { available: 'green', reserved: 'amber', sold: 'blue', delivered: 'gray', cancelled: 'red' };
const FILTERS = ['', 'available', 'reserved', 'sold', 'delivered', 'cancelled'];
const blankForm = { productId: '', atcNumber: '', atcNumberConfirm: '', vehicleId: '', litres: '', notes: '' };
const blankTruck = { plateNumber: '', driverName: '', driverPhone: '', capacity: '', ownership: 'own' };

// Same normalising the server applies (normalizeAtcNumber in lib/atcNumber.js, which is server-only).
const norm = (value) => value.replace(/\s+/g, '').toUpperCase();
const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

export default function DistributorAtcsPage() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [trucks, setTrucks] = useState([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(null); // null = closed; { id } while editing
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const [reason, setReason] = useState('');
  const [truckForm, setTruckForm] = useState(null);
  const [shown, setShown] = useState(null); // { serial, atcNumber } while the real number is on screen

  const load = useCallback(async () => {
    const [atcs, truckList] = await Promise.all([
      fetch(`/api/admin/distributor/atcs${filter ? `?status=${filter}` : ''}`).then((r) => r.json()),
      fetch('/api/admin/distributor/trucks').then((r) => r.json()),
    ]);
    if (atcs.success) { setData(atcs.data); setFailed(false); } else { setFailed(true); toast.error(atcs.error || 'Could not load ATCs'); }
    if (truckList.success) setTrucks(truckList.data);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  if (!data && failed) return <Card><EmptyState title="Could not load ATCs" subtitle="Check your connection or permissions and try again." /></Card>;
  if (!data) return <Loader />;
  const { atcs, products, permissions } = data;

  const openCreate = () => { setEditing(null); setForm({ ...blankForm }); };
  const openEdit = (atc) => {
    setEditing(atc);
    setForm({ productId: atc.productId, atcNumber: '', atcNumberConfirm: '', vehicleId: atc.vehicleId, litres: String(atc.litres), notes: atc.notes || '' });
  };

  async function save(event) {
    event.preventDefault();
    if (norm(form.atcNumber) !== norm(form.atcNumberConfirm)) return toast.error('The two ATC numbers do not match');
    setSaving(true);
    try {
      const body = { ...form };
      if (editing && !form.atcNumber && !form.atcNumberConfirm) { delete body.atcNumber; delete body.atcNumberConfirm; }
      const result = editing ? await post(`/api/admin/distributor/atcs/${editing.id}`, body, 'PATCH') : await post('/api/admin/distributor/atcs', body);
      if (!result.success) return toast.error(result.error || 'Could not save the ATC');
      toast.success(editing ? 'ATC updated' : `ATC recorded as ${result.data.serial}`);
      setForm(null); setEditing(null); load();
    } finally { setSaving(false); }
  }

  async function cancelAtc(event) {
    event.preventDefault();
    const result = await post(`/api/admin/distributor/atcs/${cancelFor.id}/cancel`, { reason });
    if (!result.success) return toast.error(result.error || 'Could not cancel the ATC');
    toast.success(`${cancelFor.serial} cancelled`);
    setCancelFor(null); setReason(''); load();
  }

  async function viewNumber(atc) {
    const result = await post(`/api/admin/distributor/atcs/${atc.id}/number`, {});
    if (result.success) setShown(result.data); else toast.error(result.error || 'Could not read the ATC number');
  }

  async function saveTruck(event) {
    event.preventDefault();
    const result = await post('/api/admin/distributor/trucks', truckForm);
    if (!result.success) return toast.error(result.error || 'Could not add the tanker');
    toast.success('Tanker added');
    setForm((f) => (f ? { ...f, vehicleId: result.data.id } : f));
    setTruckForm(null); load();
  }

  // A truck can carry one open ATC; when editing, the ATC's own truck is still choosable.
  const truckChoices = trucks.filter((t) => t.isActive);
  const selectedTruck = truckChoices.find((t) => t.id === form?.vehicleId);
  const mismatch = form && norm(form.atcNumber) !== norm(form.atcNumberConfirm) && form.atcNumberConfirm !== '';

  return (
    <div>
      <PageHeader
        title="ATCs"
        subtitle="Authority To Collect — recorded once, sold to customers by serial"
        action={permissions.manage && <button onClick={openCreate} className={btnPrimaryCls}>Record ATC</button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <button key={s || 'all'} onClick={() => { setData(null); setFilter(s); }}
            className={`rounded border px-3 py-1 text-sm ${filter === s ? 'border-brand-600 bg-brand-600 text-white' : 'bg-white hover:bg-gray-50'}`}>
            {s ? s[0].toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full min-w-[900px] text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Serial</th>
                <th className="px-3 py-3 text-left font-medium">Fuel</th>
                <th className="px-3 py-3 text-right font-medium">Litres</th>
                <th className="px-3 py-3 text-left font-medium">Truck</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
                <th className="px-3 py-3 text-left font-medium">Recorded</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {atcs.length === 0 && <EmptyRow colSpan={8} text="No ATCs" />}
              {atcs.map((atc) => {
                const total = ['sold', 'delivered'].includes(atc.status) ? atc.totalPrice : atc.currentTotalPrice;
                return (
                  <tr key={atc.id}>
                    <td className="px-4 py-3 font-medium">{atc.serial}</td>
                    <td className="px-3 py-3">{atc.product.name}</td>
                    <td className="px-3 py-3 text-right">{atc.litres.toLocaleString('en-NG')}</td>
                    <td className="px-3 py-3 text-gray-600">{atc.vehicle.plateNumber}</td>
                    <td className="px-3 py-3 text-right">{total == null ? <span className="text-amber-700">No price set</span> : formatMoney(total / 100)}</td>
                    <td className="px-3 py-3 text-gray-500">{formatDate(atc.createdAt)}</td>
                    <td className="px-3 py-3"><StatusPill status={atc.status[0].toUpperCase() + atc.status.slice(1)} color={STATUS_COLOR[atc.status]} /></td>
                    <td className="space-x-3 whitespace-nowrap px-3 py-3 text-right">
                      {permissions.viewNumber && <button onClick={() => viewNumber(atc)} className={tableActionCls}>View number</button>}
                      {permissions.manage && atc.status === 'available' && <button onClick={() => openEdit(atc)} className={tableActionCls}>Edit</button>}
                      {permissions.manage && atc.status === 'available' && <button onClick={() => { setCancelFor(atc); setReason(''); }} className={tableDangerActionCls}>Cancel</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!form} onClose={() => { setForm(null); setEditing(null); }} title={editing ? `Edit ${editing.serial}` : 'Record ATC'}>
        {form && (
          <form onSubmit={save} className="space-y-4" autoComplete="off">
            <Field label="Fuel type" required>
              <select required value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={inputCls}>
                <option value="">— Select fuel —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label={editing ? 'New ATC number (leave blank to keep)' : 'ATC number'} required={!editing}>
              <PasswordInput value={form.atcNumber} onChange={(e) => setForm({ ...form, atcNumber: e.target.value })} required={!editing} autoComplete="off" />
            </Field>
            <Field label="Enter the ATC number again" required={!editing}>
              <PasswordInput value={form.atcNumberConfirm} onChange={(e) => setForm({ ...form, atcNumberConfirm: e.target.value })} required={!editing} autoComplete="off" />
              {mismatch && <span className="mt-1 block text-xs text-red-600">The two numbers do not match.</span>}
              <span className="mt-1 block text-xs text-gray-500">Customers and sales staff only ever see the serial ATC-xxxxxx, never this number.</span>
            </Field>
            <Field label="Truck" required>
              <select required value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} className={inputCls}>
                <option value="">— Select tanker —</option>
                {truckChoices.map((t) => {
                  const busy = t.openAtc && t.openAtc.id !== editing?.id;
                  return <option key={t.id} value={t.id} disabled={busy}>{t.plateNumber} — {t.driverName} ({t.capacity?.toLocaleString('en-NG')} L){busy ? ` — carries ${t.openAtc.serial}` : ''}</option>;
                })}
              </select>
              <button type="button" onClick={() => setTruckForm({ ...blankTruck })} className="mt-1 text-xs font-medium text-brand-600 underline">Add a tanker</button>
            </Field>
            <Field label="Litres" required>
              <NumberInput value={form.litres} onChange={(e) => setForm({ ...form, litres: e.target.value })} required />
              {selectedTruck?.capacity && <span className="mt-1 block text-xs text-gray-500">This tanker holds {selectedTruck.capacity.toLocaleString('en-NG')} litres at most.</span>}
            </Field>
            <Field label="Notes">
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} rows={2} />
            </Field>
            <FormButtons onCancel={() => { setForm(null); setEditing(null); }} submitting={saving} submitLabel={editing ? 'Save changes' : 'Record ATC'} />
          </form>
        )}
      </Modal>

      <Modal open={!!truckForm} onClose={() => setTruckForm(null)} title="Add tanker">
        {truckForm && (
          <form onSubmit={saveTruck} className="space-y-4">
            <Field label="Plate number" required><input required value={truckForm.plateNumber} onChange={(e) => setTruckForm({ ...truckForm, plateNumber: e.target.value })} className={inputCls} /></Field>
            <Field label="Driver name" required><input required value={truckForm.driverName} onChange={(e) => setTruckForm({ ...truckForm, driverName: e.target.value })} className={inputCls} /></Field>
            <Field label="Driver phone"><input value={truckForm.driverPhone} onChange={(e) => setTruckForm({ ...truckForm, driverPhone: e.target.value })} className={inputCls} /></Field>
            <Field label="Capacity (litres)" required><NumberInput value={truckForm.capacity} onChange={(e) => setTruckForm({ ...truckForm, capacity: e.target.value })} required /></Field>
            <Field label="Ownership" required>
              <select value={truckForm.ownership} onChange={(e) => setTruckForm({ ...truckForm, ownership: e.target.value })} className={inputCls}>
                <option value="own">Own truck</option><option value="supplier">Supplier truck</option>
              </select>
            </Field>
            <FormButtons onCancel={() => setTruckForm(null)} submitLabel="Add tanker" />
          </form>
        )}
      </Modal>

      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title="Cancel ATC">
        {cancelFor && (
          <form onSubmit={cancelAtc} className="space-y-4">
            <p className="text-sm text-gray-600">{cancelFor.serial} will come off sale and its truck will be free for another ATC.</p>
            <Field label="Reason" required><input required value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
            <FormButtons onCancel={() => setCancelFor(null)} submitLabel="Cancel ATC" />
          </form>
        )}
      </Modal>

      <Modal open={!!shown} onClose={() => setShown(null)} title={shown ? `${shown.serial} — ATC number` : ''} size="sm">
        {shown && (
          <div className="space-y-4">
            <p className="break-all rounded bg-gray-50 p-3 text-center font-mono text-lg font-semibold">{shown.atcNumber}</p>
            <p className="text-xs text-gray-500">This view was recorded in the audit log. Do not share the number with customers or sales staff.</p>
            <button onClick={() => setShown(null)} className={`${btnPrimaryCls} w-full`}>Close</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
