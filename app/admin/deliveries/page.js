'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, EmptyState, Modal, FormButtons, Field, inputCls, btnPrimaryCls, theadCls, tableScrollCls } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const blankForm = { supplierId: '', newSupplierName: '', vehiclePlate: '', productId: '', quantity: '', costPerUnit: '' };

export default function DeliveriesPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';

  const [data, setData] = useState(null); // { deliveries, suppliers, products, onHand }
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) { setData(null); return; }
    const r = await fetch(`/api/admin/deliveries?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/deliveries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, ...form, costPerUnit: Math.round(Number(form.costPerUnit || 0) * 100) }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Delivery recorded'); setShowModal(false); setForm(blankForm); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Deliveries" subtitle="Stock received per branch" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to record and view its deliveries." /></Card>
      </div>
    );
  }

  if (!data) return <Loader />;

  const { deliveries, suppliers, products, onHand } = data;

  return (
    <div>
      <PageHeader
        title="Deliveries"
        subtitle="Stock received at this branch"
        action={<button onClick={() => { setForm(blankForm); setShowModal(true); }} className={btnPrimaryCls}>Record Delivery</button>}
      />

      {products.length > 0 && (
        <Card className="p-4 mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">On Hand</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {products.map((p) => (
              <div key={p.id}>
                <p className="text-xs text-gray-500">{p.name}</p>
                <p className="text-lg font-bold">{(onHand[p.id] || 0).toLocaleString()} <span className="text-xs font-normal text-gray-400">{p.unit}</span></p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Supplier</th>
                <th className="px-4 py-3 text-left font-medium">Product</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
                <th className="px-4 py-3 text-left font-medium">Vehicle</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deliveries.length === 0 && <EmptyRow colSpan={6} text="No deliveries recorded yet" />}
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(d.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{d.supplier?.name || '—'}</td>
                  <td className="px-4 py-3">{d.product.name}</td>
                  <td className="px-4 py-3 text-right">{d.quantity.toLocaleString()} {d.product.unit}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(d.totalCost / 100)}</td>
                  <td className="px-4 py-3 text-gray-500">{d.vehicle?.plateNumber || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Record Delivery">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Supplier" required>
            {suppliers.length > 0 ? (
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value, newSupplierName: '' })} className={inputCls}>
                <option value="">— New supplier —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <p className="text-xs text-gray-500 mb-2">No suppliers yet — name one below.</p>
            )}
            {!form.supplierId && (
              <input
                type="text" value={form.newSupplierName} onChange={(e) => setForm({ ...form, newSupplierName: e.target.value })}
                className={`${inputCls} mt-2`} placeholder="e.g., Lafarge Depot" required={!form.supplierId}
              />
            )}
          </Field>
          <Field label="Vehicle plate number">
            <input type="text" value={form.vehiclePlate} onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })} className={inputCls} placeholder="Optional" />
          </Field>
          <Field label="Product" required>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={inputCls} required>
              <option value="">Select...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" required>
              <input type="number" step="0.01" min="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={inputCls} required />
            </Field>
            <Field label="Cost per unit" required>
              <input type="number" step="0.01" min="0" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} className={inputCls} required />
            </Field>
          </div>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Record Delivery" />
        </form>
      </Modal>
    </div>
  );
}
