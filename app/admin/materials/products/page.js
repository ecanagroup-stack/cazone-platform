'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, EmptyState, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls, NumberInput } from '@/components/ui';
import { formatMoney } from '@/lib/format';

const blankForm = { name: '', unit: 'bag', price: '' };

export default function ProductsPage() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';

  const [products, setProducts] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [priceFor, setPriceFor] = useState(null); // product
  const [newPrice, setNewPrice] = useState('');

  const load = useCallback(async () => {
    if (!serviceId) { setProducts(null); return; }
    const qs = new URLSearchParams({ serviceId, ...(branchId ? { branchId } : {}) });
    const r = await fetch(`/api/admin/materials/products?${qs}`);
    const d = await r.json();
    if (d.success) setProducts(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [serviceId, branchId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, ...form, price: Math.round(Number(form.price || 0) * 100) }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowModal(false); setForm(blankForm); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (p) => {
    const r = await fetch(`/api/admin/materials/products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !p.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  const handlePriceChange = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/materials/products/${priceFor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: Math.round(Number(newPrice) * 100) }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.pricePending ? d.message : 'Price updated');
        setPriceFor(null); setNewPrice(''); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!serviceId) {
    return (
      <div>
        <PageHeader title="Shop Products" subtitle="Catalog per service" />
        <Card><EmptyState title="Pick a service" subtitle="Choose the materials/shop service from the switcher at the top of the page to manage its products." /></Card>
      </div>
    );
  }

  if (!products) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Shop Products"
        subtitle="Plain shop items — cement brands and aggregate live on their own pages under Manage"
        action={<button onClick={() => { setForm(blankForm); setShowModal(true); }} className={btnPrimaryCls}>Add Product</button>}
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Unit</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">On Hand</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.length === 0 && <EmptyRow colSpan={6} text="No products yet" />}
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-gray-500">{p.unit}</td>
                  <td className="px-4 py-3 text-right font-medium">{p.currentPrice != null ? formatMoney(p.currentPrice / 100) : '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{p.onHand != null ? `${p.onHand.toLocaleString()} ${p.unit}` : '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={p.isActive ? 'Active' : 'Inactive'} color={p.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button onClick={() => { setPriceFor(p); setNewPrice(p.currentPrice != null ? (p.currentPrice / 100).toString() : ''); }} className={tableActionCls}>Edit Price</button>
                    <button onClick={() => toggleActive(p)} className={tableActionCls}>{p.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Product">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" required>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required autoFocus />
            </Field>
            <Field label="Unit" required>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls}>
                <option value="bag">Bag</option>
                <option value="tonne">Tonne</option>
                <option value="each">Each</option>
              </select>
            </Field>
          </div>
          <Field label="Price" required>
            <NumberInput value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Product" />
        </form>
      </Modal>

      <Modal open={!!priceFor} onClose={() => setPriceFor(null)} title={`Edit Price — ${priceFor?.name || ''}`}>
        <form onSubmit={handlePriceChange} className="space-y-4">
          <p className="text-sm text-gray-500">If you're not an owner, this change won't take effect until an owner approves it.</p>
          <Field label="New price" required>
            <NumberInput value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required autoFocus />
          </Field>
          <FormButtons onCancel={() => setPriceFor(null)} submitting={submitting} submitLabel="Save" />
        </form>
      </Modal>
    </div>
  );
}
