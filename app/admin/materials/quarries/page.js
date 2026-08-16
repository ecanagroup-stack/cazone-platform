'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, btnPrimaryCls, tableActionCls, tableDangerActionCls, theadCls, tableScrollCls } from '@/components/ui';

const blankForm = { name: '', address: '', phone: '' };

// Ported from ecana_shop-app's app/admin/suppliers/page.js — a "Quarry" is a Supplier with
// type: 'quarry' (lib/prisma.js's shared Supplier model, reused rather than a new one).
export default function QuarriesPage() {
  const [quarries, setQuarries] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/materials/suppliers?type=quarry');
    const d = await r.json();
    if (d.success) setQuarries(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(blankForm); setShowModal(true); };
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, address: s.address || '', phone: s.phone || '' }); setShowModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const url = editing ? `/api/admin/materials/suppliers/${editing.id}` : '/api/admin/materials/suppliers';
      const method = editing ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, type: 'quarry' }),
      });
      const d = await r.json();
      if (d.success) { toast.success(editing ? 'Updated' : 'Created'); setShowModal(false); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (s) => {
    if (!confirm(`Deactivate ${s.name}?`)) return;
    const r = await fetch(`/api/admin/materials/suppliers/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Deactivated'); load(); } else toast.error(d.error);
  };

  if (!quarries) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Quarry"
        subtitle="Quarries you buy aggregate products from"
        action={<button onClick={openCreate} className={btnPrimaryCls}>Add Quarry</button>}
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-left font-medium">Address</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {quarries.length === 0 && <EmptyRow colSpan={4} text="No quarries added yet" />}
              {quarries.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/materials/quarries/${s.id}`} className="hover:underline">{s.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.phone || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.address || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(s)} className={`${tableActionCls} mr-3`}>Edit</button>
                    <button onClick={() => handleDelete(s)} className={tableDangerActionCls}>Deactivate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Quarry' : 'Add Quarry'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <Field label="Phone">
            <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Address">
            <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel={editing ? 'Save' : 'Add Quarry'} />
        </form>
      </Modal>
    </div>
  );
}
