'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Loader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, btnPrimaryCls,
  tableActionCls, tableDangerActionCls, theadCls, tableScrollCls, NumberInput,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';

const blankForm = { size: '', currentPricePerTonne: '' };

// Ported from ecana_shop-app's app/admin/suppliers/[id]/page.js.
export default function QuarryDetailPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';

  const [quarry, setQuarry] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [priceModal, setPriceModal] = useState(null);
  const [newPrice, setNewPrice] = useState('');
  const [priceReason, setPriceReason] = useState('');

  const load = useCallback(async () => {
    const [sRes, pRes] = await Promise.all([
      fetch('/api/admin/materials/suppliers?type=quarry').then((r) => r.json()),
      serviceId ? fetch(`/api/admin/materials/stonedust?serviceId=${serviceId}`).then((r) => r.json()) : Promise.resolve({ success: true, data: [] }),
    ]);
    if (sRes.success) setQuarry(sRes.data.find((s) => s.id === id) || null);
    if (pRes.success) setProducts(pRes.data.filter((p) => p.quarry === id));
    setLoading(false);
  }, [id, serviceId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(blankForm); setShowModal(true); };
  const openEdit = (p) => { setEditing(p); setForm({ size: p.size || '', currentPricePerTonne: p.currentPrice != null ? (p.currentPrice / 100).toString() : '' }); setShowModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const url = editing ? `/api/admin/materials/stonedust/${editing.id}` : '/api/admin/materials/stonedust';
      const method = editing ? 'PATCH' : 'POST';
      const body = editing
        ? { size: form.size }
        : { serviceId, quarry: id, size: form.size, currentPricePerTonne: Math.round(Number(form.currentPricePerTonne) * 100) };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) { toast.success(editing ? 'Updated' : 'Product added'); setShowModal(false); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (p) => {
    if (!confirm(`Deactivate ${p.size}?`)) return;
    const r = await fetch(`/api/admin/materials/stonedust/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Deactivated'); load(); } else toast.error(d.error);
  };

  const handlePriceChange = async (e) => {
    e.preventDefault();
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

  if (loading) return <Loader />;
  if (!quarry) return <p className="text-gray-500">Quarry not found</p>;

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/materials/quarries" className="text-sm text-brand-700 hover:underline">← Back to Quarries</Link>
        <div className="flex flex-wrap justify-between items-center gap-3 mt-2">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{quarry.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{quarry.phone || 'No phone'} {quarry.address ? `· ${quarry.address}` : ''}</p>
          </div>
          {serviceId
            ? <button onClick={openCreate} className={btnPrimaryCls}>Add Product</button>
            : <span className="text-sm text-gray-500">Pick a service to add products</span>}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Size</th>
                <th className="px-4 py-3 text-right font-medium">Cost / Tonne</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.length === 0 && <EmptyRow colSpan={3} text="No products added for this quarry yet" />}
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.size}</td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Product' : `Add Product — ${quarry.name}`}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Size" required>
            <input type="text" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} className={inputCls} required placeholder="e.g., 6mm, 10mm, 20mm" />
          </Field>
          <Field label={editing ? 'Cost per tonne (use Price button to change)' : 'Cost per tonne'} required={!editing}>
            <NumberInput value={form.currentPricePerTonne} onChange={(e) => setForm({ ...form, currentPricePerTonne: e.target.value })} required={!editing} disabled={!!editing} />
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel={editing ? 'Save' : 'Add Product'} />
        </form>
      </Modal>

      <Modal open={!!priceModal} onClose={() => setPriceModal(null)} title="Update Cost">
        {priceModal && (
          <form onSubmit={handlePriceChange} className="space-y-4">
            <div className="bg-gray-50 p-3 rounded text-sm">
              <p><span className="text-gray-500">Product:</span> <span className="font-medium">{quarry.name} — {priceModal.size}</span></p>
              <p><span className="text-gray-500">Current:</span> <span className="font-medium">{priceModal.currentPrice != null ? formatMoney(priceModal.currentPrice / 100) : '—'}</span></p>
            </div>
            <Field label="New cost per tonne" required>
              <NumberInput value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required autoFocus />
            </Field>
            <Field label="Reason">
              <input type="text" value={priceReason} onChange={(e) => setPriceReason(e.target.value)} className={inputCls} placeholder="optional" />
            </Field>
            <FormButtons onCancel={() => setPriceModal(null)} submitting={submitting} submitLabel="Update Cost" />
          </form>
        )}
      </Modal>
    </div>
  );
}
