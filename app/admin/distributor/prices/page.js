'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, Field, FormButtons, Loader, Modal, NumberInput, PageHeader, inputCls, tableActionCls } from '@/components/ui';
import { formatMoney } from '@/lib/format';

// ATC price per litre, one per fuel. Sold ATCs keep the price they were sold at; a change only affects
// ATCs sold afterwards. A manager's change to an existing price waits for the Admin's approval.
export default function DistributorPricesPage() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ price: '', reason: '' });

  const load = useCallback(async () => {
    const result = await fetch('/api/admin/distributor/price').then((r) => r.json());
    if (result.success) setData(result.data); else toast.error(result.error || 'Could not load prices');
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Loader />;

  async function save(event) {
    event.preventDefault();
    const result = await fetch('/api/admin/distributor/price', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: editing.id, price: form.price, reason: form.reason }),
    }).then((r) => r.json());
    if (!result.success) return toast.error(result.error || 'Could not save the price');
    toast.success(result.pricePending ? result.message : 'Price updated');
    setEditing(null); load();
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="ATC prices" subtitle="Price per litre, applied to the litres on each ATC" />
      <div className="space-y-3">
        {data.products.map((product) => (
          <Card key={product.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="font-semibold text-gray-900">{product.name}</p>
              <p className="text-sm text-gray-600">
                {product.pricePerLitre == null ? <span className="text-amber-700">No price set — ATCs of this fuel cannot be sold yet</span> : `${formatMoney(product.pricePerLitre / 100)} per litre`}
              </p>
              {product.pendingPrice != null && <p className="text-xs text-amber-700">{formatMoney(product.pendingPrice / 100)} awaiting Admin approval</p>}
            </div>
            {data.canSetPrice && (
              <button onClick={() => { setEditing(product); setForm({ price: product.pricePerLitre == null ? '' : String(product.pricePerLitre / 100), reason: '' }); }} className={tableActionCls}>
                {product.pricePerLitre == null ? 'Set price' : 'Change price'}
              </button>
            )}
          </Card>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `${editing.name} price` : ''}>
        {editing && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Price per litre (₦)" required><NumberInput value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></Field>
            <Field label="Reason" required><input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls} /></Field>
            <FormButtons onCancel={() => setEditing(null)} submitLabel="Save price" />
          </form>
        )}
      </Modal>
    </div>
  );
}
