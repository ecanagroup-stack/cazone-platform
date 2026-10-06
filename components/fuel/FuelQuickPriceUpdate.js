'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

export default function FuelQuickPriceUpdate({ selectedBranchId }) {
  const [options, setOptions] = useState(null);
  const [branchId, setBranchId] = useState(selectedBranchId || '');
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setBranchId(selectedBranchId || ''); }, [selectedBranchId]);
  useEffect(() => {
    fetch('/api/admin/fuel/prices').then((response) => response.json()).then((result) => {
      if (result.success) setOptions(result.data);
    });
  }, []);
  async function submit(event) {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch('/api/admin/fuel/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branchId, productId, price, reason }) });
      const result = await response.json();
      if (!result.success) return toast.error(result.error || 'Could not update price');
      toast.success('Fuel price updated'); setPrice(''); setReason('');
    } finally { setSaving(false); }
  }
  if (!options || options.historicalOnly || options.branches.length === 0 || options.products.length === 0) return null;
  return <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold text-gray-900">Quick Price Update</h2><p className="mt-1 text-xs text-gray-500">Set a station fuel price with a recorded reason.</p><form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Station *<select required value={branchId} onChange={(event) => setBranchId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Select station</option>{options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="text-sm font-medium">Fuel *<select required value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Select fuel</option>{options.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label className="text-sm font-medium">Price (₦/L) *<input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><label className="text-sm font-medium">Reason *<input required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. approved price update" className="mt-1 w-full rounded-lg border px-3 py-2"/></label><button disabled={saving} className="rounded-lg bg-rose-800 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Updating…' : 'Update Price'}</button></form></section>;
}
