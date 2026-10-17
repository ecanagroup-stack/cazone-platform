'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Card, EmptyState, EmptyRow, Field, Loader, Modal, PageHeader, btnPrimaryCls, inputCls, tableActionCls, tableDangerActionCls, tableScrollCls, theadCls } from '@/components/ui';

const blank = { name: '', unit: 'litre', price: '' };

export default function FuelProductsPage() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const [products, setProducts] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState([]);

  const load = useCallback(async () => {
    if (!serviceId) return setProducts([]);
    const response = await fetch(`/api/admin/materials/products?serviceId=${encodeURIComponent(serviceId)}`);
    const body = await response.json();
    if (body.success) setProducts(body.data);
    else toast.error(body.error || 'Could not load fuel products');
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/admin/services').then((response) => response.json()).then((body) => {
      if (body.success) setBranches(body.data.find((service) => service.id === serviceId)?.branches || []);
    });
  }, [serviceId]);

  const openCreate = () => { setEditing(null); setForm(blank); setShowModal(true); };
  const openEdit = (product) => {
    setEditing(product);
    setForm({ name: product.name, unit: product.unit, price: product.currentPrice == null ? '' : String(product.currentPrice / 100) });
    setShowModal(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/admin/materials/products/${editing.id}` : '/api/admin/materials/products', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(editing ? {} : { serviceId }), name: form.name, unit: form.unit, price: Math.round(Number(form.price || 0) * 100) }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Could not save product');
      toast.success(editing ? 'Product updated' : 'Product added');
      setShowModal(false);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (product) => {
    if (!confirm(`Deactivate ${product.name}? It will remain available in existing records, but cannot be assigned to new tanks.`)) return;
    const response = await fetch(`/api/admin/materials/products/${product.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }),
    });
    const body = await response.json();
    if (body.success) { toast.success('Product deactivated'); load(); } else toast.error(body.error || 'Could not deactivate product');
  };

  if (!serviceId) return <Card><EmptyState title="Pick a station" subtitle="Choose a Petrol Station branch from the switcher at the top of the page." /></Card>;
  if (!products) return <Loader />;

  return (
    <div>
      <PageHeader title="Fuel Products" subtitle="Catalog products here, then assign them to a station tank." action={<button onClick={openCreate} className={btnPrimaryCls}>Add Product</button>} />
      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}><tr><th className="px-4 py-3 text-left font-medium">Product</th><th className="px-4 py-3 text-left font-medium">Used at</th><th className="px-4 py-3 text-left font-medium">Unit</th><th className="px-4 py-3 text-right font-medium">Current price</th><th className="px-4 py-3 text-right font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Actions</th></tr></thead>
            <tbody className="divide-y">
              {products.length === 0 && <EmptyRow colSpan={6} text="No fuel products yet" />}
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-3 font-medium">{product.name}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {product.tanks?.length ? product.tanks.map((tank) => `${tank.branch.name} — ${tank.label}`).join(', ') : 'Not assigned'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{product.unit}</td>
                  <td className="px-4 py-3 text-right">{product.currentPrice == null ? '—' : `₦${(product.currentPrice / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`}</td>
                  <td className="px-4 py-3 text-right">{product.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="px-4 py-3 text-right">
                    {product.isActive && branches.map((branch) => <Link key={branch.id} href={`/admin/fuel/tanks?branch=${branch.id}&product=${product.id}`} className={`${tableActionCls} mr-3`}>Assign to station</Link>)}
                    <button onClick={() => openEdit(product)} className={`${tableActionCls} mr-3`}>Edit</button>
                    {product.isActive && <button onClick={() => deactivate(product)} className={tableDangerActionCls}>Deactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Fuel Product' : 'Add Fuel Product'}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Product name" required><input className={inputCls} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Petrol" required autoFocus /></Field>
          <Field label="Unit" required><input className={inputCls} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="e.g. litre" required /></Field>
          <Field label="Current price per unit"><input className={inputCls} type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0.00" /></Field>
          <button disabled={saving} className={`${btnPrimaryCls} disabled:opacity-50`}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button>
        </form>
      </Modal>
    </div>
  );
}
