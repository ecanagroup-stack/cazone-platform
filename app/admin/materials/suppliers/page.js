'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls } from '@/components/ui';

const blankForm = { name: '', type: 'depot', phone: '', address: '' };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/materials/suppliers');
    const d = await r.json();
    if (d.success) setSuppliers(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowModal(false); setForm(blankForm); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (s) => {
    const r = await fetch(`/api/admin/materials/suppliers/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !s.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  if (!suppliers) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Depots, quarries and other sources"
        action={<button onClick={() => { setForm(blankForm); setShowModal(true); }} className={btnPrimaryCls}>Add Supplier</button>}
      />

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
