'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyState, EmptyRow, Modal, FormButtons, Field, inputCls, btnPrimaryCls,
  tableActionCls, tableDangerActionCls, theadCls, tableScrollCls, NumberInput,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';

const blankForm = { name: '', abbreviation: '', grade: '', bagSize: 50, currentPricePerBag: '', depot: '' };

// Ported from ecana_shop-app's app/admin/cement-brands/page.js field-for-field — the abbreviation
// (max 3 letters) drives ATC numbering (M2), so it's collected here, not on a generic product form.
export default function CementBrandsPage() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';

  const [brands, setBrands] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const [priceModal, setPriceModal] = useState(null);
  const [newPrice, setNewPrice] = useState('');
  const [priceReason, setPriceReason] = useState('');

  const load = useCallback(async () => {
    if (!serviceId) { setBrands(null); return; }
    const r = await fetch(`/api/admin/materials/cement-brands?serviceId=${serviceId}`);
    const d = await r.json();
    if (d.success) setBrands(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(blankForm); setShowModal(true); };
  const openEdit = (b) => {
    setEditing(b);
    setForm({
      name: b.name, abbreviation: b.abbreviation || '', grade: b.attributes?.grade || '',
      bagSize: b.attributes?.bagSize || 50, currentPricePerBag: b.currentPrice != null ? (b.currentPrice / 100).toString() : '',
      depot: b.attributes?.depotName || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const url = editing ? `/api/admin/materials/cement-brands/${editing.id}` : '/api/admin/materials/cement-brands';
      const method = editing ? 'PATCH' : 'POST';
      const body = {
        serviceId, name: form.name, abbreviation: form.abbreviation, grade: form.grade, depot: form.depot,
        bagSize: Number(form.bagSize), currentPricePerBag: Math.round(Number(form.currentPricePerBag) * 100),
      };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) { toast.success(editing ? 'Updated' : 'Created'); setShowModal(false); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (b) => {
    if (!confirm(`Deactivate ${b.name}?`)) return;
    const r = await fetch(`/api/admin/materials/cement-brands/${b.id}`, {
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
      const r = await fetch(`/api/admin/materials/cement-brands/${priceModal.id}/price`, {
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
        <PageHeader title="Cement Brands" subtitle="Brands you sell with their current per-bag price" />
        <Card><EmptyState title="Pick a service" subtitle="Choose Construction Material from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (!brands) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Cement Brands"
        subtitle="Brands you sell with their current per-bag price"
        action={<button onClick={openCreate} className={btnPrimaryCls}>Add Brand</button>}
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Brand</th>
                <th className="px-4 py-3 text-left font-medium">Abbr</th>
                <th className="px-4 py-3 text-left font-medium">Grade</th>
                <th className="px-4 py-3 text-left font-medium">Depot</th>
                <th className="px-4 py-3 text-right font-medium">Bag Size</th>
                <th className="px-4 py-3 text-right font-medium">Current Price</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {brands.length === 0 && <EmptyRow colSpan={7} text="No cement brands yet" />}
              {brands.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 font-mono font-bold text-gray-900">{b.abbreviation || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{b.attributes?.grade || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{b.attributes?.depotName || '—'}</td>
                  <td className="px-4 py-3 text-right">{b.attributes?.bagSize || 50}kg</td>
                  <td className="px-4 py-3 text-right font-medium">{b.currentPrice != null ? formatMoney(b.currentPrice / 100) : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setPriceModal(b); setNewPrice(b.currentPrice != null ? (b.currentPrice / 100).toString() : ''); }} className={`${tableActionCls} mr-3`}>Price</button>
                    <button onClick={() => openEdit(b)} className={`${tableActionCls} mr-3`}>Edit</button>
                    <button onClick={() => handleDelete(b)} className={tableDangerActionCls}>Deactivate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Brand' : 'Add Brand'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Brand name" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required autoFocus placeholder="e.g., Dangote" />
          </Field>
          <Field label="Abbreviation (3 letters max)" required>
            <input
              type="text" value={form.abbreviation}
              onChange={(e) => setForm({ ...form, abbreviation: e.target.value.toUpperCase().slice(0, 3) })}
              className={inputCls} required placeholder="e.g., DAN, BUA, MGX" maxLength={3}
            />
            <p className="text-xs text-gray-500 mt-1">Used in ATC numbers (e.g., DAN-001)</p>
          </Field>
          <Field label="Grade">
            <input type="text" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} className={inputCls} placeholder="e.g., 42.5N" />
          </Field>
          <Field label="Depot (optional)">
            <input type="text" value={form.depot} onChange={(e) => setForm({ ...form, depot: e.target.value })} className={inputCls} placeholder="e.g., Central Warehouse, Port Depot" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bag size (kg)">
              <NumberInput value={form.bagSize} onChange={(e) => setForm({ ...form, bagSize: e.target.value })} />
            </Field>
            <Field label={editing ? 'Price (use Price button to change)' : 'Price per bag'} required={!editing}>
              <NumberInput value={form.currentPricePerBag} onChange={(e) => setForm({ ...form, currentPricePerBag: e.target.value })} required={!editing} disabled={!!editing} />
            </Field>
          </div>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel={editing ? 'Save' : 'Add Brand'} />
        </form>
      </Modal>

      <Modal open={!!priceModal} onClose={() => setPriceModal(null)} title="Update Price">
        {priceModal && (
          <form onSubmit={handlePriceChange} className="space-y-4">
            <div className="bg-gray-50 p-3 rounded text-sm">
              <p><span className="text-gray-500">Brand:</span> <span className="font-medium">{priceModal.name}</span></p>
              <p><span className="text-gray-500">Current price:</span> <span className="font-medium">{priceModal.currentPrice != null ? formatMoney(priceModal.currentPrice / 100) : '—'}</span></p>
            </div>
            <Field label="New price per bag" required>
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
