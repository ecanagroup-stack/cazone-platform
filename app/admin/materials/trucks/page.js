'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls,
  tableActionCls, tableDangerActionCls, theadCls, tableScrollCls, NumberInput,
} from '@/components/ui';

const blankForm = { plateNumber: '', driverName: '', driverPhone: '', type: 'cement', capacityTonnes: '', ownership: 'own' };

// Ported from ecana_shop-app's app/admin/trucks/page.js — a truck must be typed cement-or-aggregate
// (the two fleets are kept separate, same as the old app) and can't be edited while busy on an ATC.
export default function TrucksPage() {
  const [trucks, setTrucks] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/materials/trucks');
    const d = await r.json();
    if (d.success) setTrucks(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(blankForm); setShowModal(true); };
  const openEdit = (t) => {
    if (t.busy) { toast.error(`Can't edit ${t.plateNumber} — ${t.busyReason}`); return; }
    setEditing(t);
    setForm({
      plateNumber: t.plateNumber, driverName: t.driverName, driverPhone: t.driverPhone || '',
      type: t.type || 'cement', capacityTonnes: t.capacity || '', ownership: t.ownership || 'own',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const url = editing ? `/api/admin/materials/trucks/${editing.id}` : '/api/admin/materials/trucks';
      const method = editing ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await r.json();
      if (d.success) { toast.success(editing ? 'Updated' : 'Created'); setShowModal(false); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (t) => {
    if (!confirm(`Deactivate ${t.plateNumber}?`)) return;
    const r = await fetch(`/api/admin/materials/trucks/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Deactivated'); load(); } else toast.error(d.error);
  };

  if (!trucks) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Trucks"
        subtitle="Trucks used for deliveries and ATC pickups"
        action={<button onClick={openCreate} className={btnPrimaryCls}>Add Truck</button>}
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Plate</th>
                <th className="px-4 py-3 text-left font-medium">Driver</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Capacity</th>
                <th className="px-4 py-3 text-left font-medium">Ownership</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {trucks.length === 0 && <EmptyRow colSpan={8} text="No trucks yet" />}
              {trucks.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium">{t.plateNumber}</td>
                  <td className="px-4 py-3">{t.driverName}</td>
                  <td className="px-4 py-3 text-gray-500">{t.driverPhone || '—'}</td>
                  <td className="px-4 py-3">
                    {t.type === 'cement'
                      ? <StatusPill status="Cement (Bags)" color="blue" />
                      : t.type === 'aggregate'
                        ? <StatusPill status="Aggregate (Tonnes)" color="amber" />
                        : <StatusPill status="Type not set" color="gray" />}
                  </td>
                  <td className="px-4 py-3 text-right">{t.capacity ? `${t.capacity}t` : '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={t.ownership === 'own' ? 'Own' : 'Supplier'} color={t.ownership === 'own' ? 'green' : 'blue'} /></td>
                  <td className="px-4 py-3">
                    {t.busy ? <StatusPill status={t.busyReason} color="amber" /> : <span className="text-gray-400 text-xs">Free</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(t)} className={`${tableActionCls} mr-3 ${t.busy ? 'opacity-40 cursor-not-allowed' : ''}`}>Edit</button>
                    <button onClick={() => handleDelete(t)} className={tableDangerActionCls}>Deactivate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Truck' : 'Add Truck'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Plate number" required>
            <input type="text" value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value.toUpperCase() })} className={inputCls} required autoFocus />
          </Field>
          {editing && (
            <p className="text-xs text-gray-500 -mt-2">Changing this only updates the truck's own record — past ATCs, sales, and reports keep whatever plate number was recorded at the time.</p>
          )}
          <Field label="Driver name" required>
            <input type="text" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} className={inputCls} required />
          </Field>
          <Field label="Driver phone">
            <input type="text" value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Truck type" required>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls} required>
              <option value="cement">Cement (Bags)</option>
              <option value="aggregate">Aggregate (Tonnes)</option>
            </select>
          </Field>
          <Field label="Capacity (tonnes)">
            <NumberInput value={form.capacityTonnes} onChange={(e) => setForm({ ...form, capacityTonnes: e.target.value })} />
          </Field>
          <Field label="Ownership">
            <select value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value })} className={inputCls}>
              <option value="own">Own</option>
              <option value="supplier">Supplier's truck</option>
            </select>
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel={editing ? 'Save' : 'Add Truck'} />
        </form>
      </Modal>
    </div>
  );
}
