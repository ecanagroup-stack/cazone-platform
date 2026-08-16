'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyState, EmptyRow, Modal, FormButtons, Field, inputCls, btnPrimaryCls,
  tableActionCls, tableDangerActionCls, theadCls, tableScrollCls, NumberInput,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';

const blankForm = { quarry: '', size: '', currentPricePerTonne: '' };

// Ported from ecana_shop-app's app/admin/stonedust/page.js field-for-field.
export default function StonedustPage() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';

  const [products, setProducts] = useState(null);
  const [quarries, setQuarries] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [priceModal, setPriceModal] = useState(null);
  const [newPrice, setNewPrice] = useState('');
  const [priceReason, setPriceReason] = useState('');

  const load = useCallback(async () => {
    if (!serviceId) { setProducts(null); return; }
    const [p, q] = await Promise.all([
      fetch(`/api/admin/materials/stonedust?serviceId=${serviceId}`).then((r) => r.json()),
      fetch('/api/admin/materials/suppliers?type=quarry').then((r) => r.json()),
    ]);
    if (p.success) setProducts(p.data); else toast.error(p.error || 'Failed to load');
    if (q.success) setQuarries(q.data);
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(blankForm); setShowModal(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ quarry: p.quarry, size: p.size || '', currentPricePerTonne: p.currentPrice != null ? (p.currentPrice / 100).toString() : '' });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const url = editing ? `/api/admin/materials/stonedust/${editing.id}` : '/api/admin/materials/stonedust';
      const method = editing ? 'PATCH' : 'POST';
      const body = editing
        ? { size: form.size }
        : { serviceId, quarry: form.quarry, size: form.size, currentPricePerTonne: Math.round(Number(form.currentPricePerTonne) * 100) };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) { toast.success(editing ? 'Updated' : 'Created'); setShowModal(false); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (p) => {
    if (!confirm(`Deactivate ${p.quarryName} ${p.size}?`)) return;
    const r = await fetch(`/api/admin/materials/stonedust/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Deactivated'); load(); } else toast.error(d.error);
  };

  const handlePriceChange = async (e) => {
    e.preventDefault();
    if (!newPrice || Number(newPrice) <= 0) return toast.error('Enter a valid price');
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/materials/stonedust/${priceModal.id}/price`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPrice: Math.round(Number(newPrice) * 100), reason: priceReason }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.pricePending ? d.message : 'Price updated');
        setPriceModal(null); setNewPrice(''); setPriceReason(''); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!serviceId) {
    return (
      <div>
        <PageHeader title="Aggregate Products" subtitle="Quarry products defined by quarry + size + per-tonne price" />
        <Card><EmptyState title="Pick a service" subtitle="Choose Construction Material from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (!products) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Aggregate Products"
        subtitle="Quarry products defined by quarry + size + per-tonne price"
        action={
          quarries.length === 0
            ? <span className="text-sm text-gray-500">Add a quarry first (Manage → Quarries)</span>
            : <button onClick={openCreate} className={btnPrimaryCls}>Add Product</button>
        }
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Quarry</th>
                <th className="px-4 py-3 text-left font-medium">Size</th>
                <th className="px-4 py-3 text-right font-medium">Price / Tonne</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.length === 0 && <EmptyRow colSpan={4} text="No aggregate products" />}
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.quarryName}</td>
                  <td className="px-4 py-3">{p.size}</td>
                  <td className="px-4 py-3 text-right font-medium">{p.currentPrice != null ? formatMoney(p.currentPrice / 100) : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setPriceModal(p); setNewPrice(p.currentPrice != null ? (p.currentPrice / 100).toString() : ''); }} className={`${tableActionCls} mr-3`}>Price</button>
                    <button onClick={() => openEdit(p)} className={`${tableActionCls} mr-3`}>Edit</button>
                    <button onClick={() => handleDelete(p)} className={tableDangerActionCls}>Deactivate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Aggregate' : 'Add Aggregate'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Quarry" required>
            <select value={form.quarry} onChange={(e) => setForm({ ...form, quarry: e.target.value })} className={inputCls} required disabled={!!editing}>
              <option value="">— Select quarry —</option>
              {quarries.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </Field>
          <Field label="Size" required>
            <input type="text" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} className={inputCls} required placeholder="e.g., 6mm, 10mm, 20mm" />
          </Field>
          <Field label={editing ? 'Price (use Price button to change)' : 'Price per tonne'} required={!editing}>
            <NumberInput value={form.currentPricePerTonne} onChange={(e) => setForm({ ...form, currentPricePerTonne: e.target.value })} required={!editing} disabled={!!editing} />
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel={editing ? 'Save' : 'Add Aggregate'} />
        </form>
      </Modal>

      <Modal open={!!priceModal} onClose={() => setPriceModal(null)} title="Update Price">
        {priceModal && (
          <form onSubmit={handlePriceChange} className="space-y-4">
            <div className="bg-gray-50 p-3 rounded text-sm">
              <p><span className="text-gray-500">Product:</span> <span className="font-medium">{priceModal.quarryName} — {priceModal.size}</span></p>
              <p><span className="text-gray-500">Current:</span> <span className="font-medium">{priceModal.currentPrice != null ? formatMoney(priceModal.currentPrice / 100) : '—'}</span></p>
            </div>
            <Field label="New price per tonne" required>
              <NumberInput value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required autoFocus />
            </Field>
            <Field label="Reason">
              <input type="text" value={priceReason} onChange={(e) => setPriceReason(e.target.value)} className={inputCls} placeholder="optional" />
            </Field>
            <p className="text-xs text-gray-500">If you're not an owner, this change won't take effect until an owner approves it.</p>
            <FormButtons onCancel={() => setPriceModal(null)} submitting={submitting} submitLabel="Update Price" />
          </form>
        )}
      </Modal>
    </div>
  );
}
