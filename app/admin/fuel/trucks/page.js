'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

const blank = { plateNumber: '', driverName: '', driverPhone: '', capacity: '', ownership: 'own', reason: '' };

export default function FuelTrucksPage() {
  const [trucks, setTrucks] = useState(null);
  const [historicalOnly, setHistoricalOnly] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/fuel/trucks');
    const result = await response.json();
    if (result.success) { setTrucks(result.data); setHistoricalOnly(result.historicalOnly); }
    else toast.error(result.error || 'Could not load fuel trucks');
  }, []);
  useEffect(() => { load(); }, [load]);
  async function saveTruck(event) {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch(editing ? `/api/admin/fuel/trucks/${editing.id}` : '/api/admin/fuel/trucks', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!result.success) return toast.error(result.error || 'Could not save truck');
      toast.success(editing ? 'Fuel truck updated' : 'Fuel truck added'); setForm(blank); setEditing(null); setShowForm(false); load();
    } finally { setSaving(false); }
  }
  async function toggle(truck) {
    const reason = window.prompt(`Reason for ${truck.isActive ? 'deactivating' : 'reactivating'} ${truck.plateNumber}:`);
    if (!reason?.trim()) return;
    const response = await fetch(`/api/admin/fuel/trucks/${truck.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !truck.isActive, reason }) });
    const result = await response.json();
    if (result.success) { toast.success('Truck updated'); load(); } else toast.error(result.error || 'Could not update truck');
  }
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Station logistics</p><h1 className="mt-1 text-3xl font-bold">Fuel Trucks</h1><p className="mt-1 text-sm text-gray-500">Tankers and their recent station offloads.</p></div>{trucks && !historicalOnly && <button onClick={() => { setEditing(null); setForm(blank); setShowForm((value) => !value); }} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">{showForm ? 'Close form' : 'Add truck'}</button>}</div>
    {showForm && !historicalOnly && <form onSubmit={saveTruck} className="grid gap-3 rounded-xl border bg-white p-5 sm:grid-cols-2"><input required disabled={!!editing} placeholder="Plate number" value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} className="rounded-lg border px-3 py-2 disabled:bg-gray-50"/><input required placeholder="Driver name" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} className="rounded-lg border px-3 py-2"/><input placeholder="Driver phone" value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} className="rounded-lg border px-3 py-2"/><input type="number" min="0.01" step="any" placeholder="Capacity (litres)" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="rounded-lg border px-3 py-2"/><select value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value })} className="rounded-lg border px-3 py-2"><option value="own">Own truck</option><option value="supplier">Supplier truck</option></select>{editing && <input required placeholder="Reason for change" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="rounded-lg border px-3 py-2"/>}<button disabled={saving} className="rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Saving…' : editing ? 'Save changes' : 'Save truck'}</button></form>}
    {!trucks ? <p className="text-sm text-gray-500">Loading trucks…</p> : trucks.length === 0 ? <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">No fuel trucks yet.</p> : <div className="grid gap-4 md:grid-cols-2">{trucks.map((truck) => <div key={truck.id} className="rounded-xl border bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-gray-900">{truck.plateNumber}</h2><p className="text-sm text-gray-600">{truck.driverName || 'Driver not recorded'}{truck.driverPhone ? ` · ${truck.driverPhone}` : ''}</p><p className="text-xs text-gray-500">{truck.capacity ? `${truck.capacity.toLocaleString()} L · ` : ''}{truck.ownership === 'supplier' ? 'Supplier' : 'Own'} truck</p></div>{!historicalOnly && <div className="flex gap-3"><button onClick={() => { setEditing(truck); setForm({ plateNumber: truck.plateNumber, driverName: truck.driverName || '', driverPhone: truck.driverPhone || '', capacity: truck.capacity || '', ownership: truck.ownership || 'own', reason: '' }); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-xs font-semibold text-brand-700">Edit</button><button onClick={() => toggle(truck)} className="text-xs font-semibold text-brand-700">{truck.isActive ? 'Deactivate' : 'Reactivate'}</button></div>}</div><h3 className="mt-4 border-t pt-3 text-xs font-bold uppercase tracking-wide text-gray-500">Recent offloads</h3><div className="mt-2 space-y-2">{truck.deliveries.map((delivery) => <p key={delivery.id} className="text-sm text-gray-700">{new Date(delivery.createdAt).toLocaleDateString('en-NG')} · {delivery.branch.name} · {delivery.quantity.toLocaleString()} {delivery.product.unit} {delivery.product.name}</p>)}{truck.deliveries.length === 0 && <p className="text-sm text-gray-500">No offloads recorded</p>}</div></div>)}</div>}
  </div>;
}
