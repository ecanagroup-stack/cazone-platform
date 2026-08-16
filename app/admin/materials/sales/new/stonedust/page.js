'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyState, Field, inputCls, btnPrimaryCls, OtpField, NumberInput,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';

// Ported from ecana_shop-app's app/admin/sales/new/stonedust/page.js — single customer, truck-based,
// bidirectional Sell Price/Tonne <-> Total Amount (typing either recalculates the other). Unlike
// cement there's no pre-existing allocation to pick from — the truck brings the aggregate straight
// from the quarry, so the sale itself is what records the purchase (app/api/admin/materials/sales/
// aggregate handles both legs in one call).
export default function NewAggregateSalePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';

  const [products, setProducts] = useState(null);
  const [trucks, setTrucks] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const [vehicleId, setVehicleId] = useState('');
  const [showTruckDrop, setShowTruckDrop] = useState(false);
  const [discount, setDiscount] = useState('');
  const [transportFee, setTransportFee] = useState('');

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customer, setCustomer] = useState(null);

  const [productId, setProductId] = useState('');
  const [billQty, setBillQty] = useState('');
  const [actualQty, setActualQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [total, setTotal] = useState('');

  const [showTransportWarning, setShowTransportWarning] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null);
  const [overridePin, setOverridePin] = useState('');

  const load = useCallback(async () => {
    if (!serviceId) { setProducts(null); return; }
    const [p, t] = await Promise.all([
      fetch(`/api/admin/materials/stonedust?serviceId=${serviceId}`).then((r) => r.json()),
      fetch('/api/admin/materials/trucks').then((r) => r.json()),
    ]);
    if (p.success) setProducts(p.data); else toast.error(p.error || 'Failed to load');
    if (t.success) setTrucks(t.data.filter((x) => x.type === 'aggregate'));
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (customerQuery.trim().length < 2 || !branchId) { setCustomerResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(customerQuery)}&branchId=${branchId}`);
      const d = await r.json();
      if (d.success) setCustomerResults(d.data);
    }, 250);
    return () => clearTimeout(t);
  }, [customerQuery, branchId]);

  const selectedProduct = (products || []).find((p) => p.id === productId);
  const selectedTruck = trucks.find((t) => t.id === vehicleId);
  const effectiveBillQty = billQty || actualQty;

  const handleUnitPriceChange = (val) => {
    setUnitPrice(val);
    if (effectiveBillQty && val) setTotal((Number(effectiveBillQty) * Number(val)).toFixed(2));
  };
  const handleTotalChange = (val) => {
    setTotal(val);
    if (effectiveBillQty && val && Number(effectiveBillQty) > 0) setUnitPrice((Number(val) / Number(effectiveBillQty)).toFixed(2));
  };
  const handleActualQtyChange = (val) => {
    setActualQty(val);
    if (!billQty && unitPrice) setTotal((Number(val || 0) * Number(unitPrice)).toFixed(2));
  };
  const handleBillQtyChange = (val) => {
    setBillQty(val);
    if (unitPrice) setTotal((Number(val || actualQty || 0) * Number(unitPrice)).toFixed(2));
  };

  const subtotal = Number(total) || (Number(effectiveBillQty) || 0) * (Number(unitPrice) || 0) || 0;
  const grandTotal = subtotal - (Number(discount) || 0) + (Number(transportFee) || 0);

  const submit = async (overrideCredit = false, otp = '') => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/sales/aggregate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, customerId: customer.id, productId, vehicleId,
          actualQty: Number(actualQty), billQty: Number(effectiveBillQty), unitPrice: Number(unitPrice),
          discount: Number(discount) || 0, transportFee: Number(transportFee) || 0,
          overrideCredit, otp,
        }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(`Sale ${d.data.order.orderNumber} recorded`);
        router.push('/admin/materials/atcs');
      } else if (d.needsApproval) {
        setCreditWarning(d);
      } else {
        toast.error(d.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!customer) return toast.error('Select a customer');
    if (!productId || !actualQty || !unitPrice) return toast.error('Select product, quantity and price');
    if (!vehicleId) return toast.error('Select a truck');
    setCreditWarning(null);
    if (!transportFee || transportFee === '0') { setShowTransportWarning(true); return; }
    submit();
  };

  if (!serviceId || !branchId) {
    return (
      <div>
        <PageHeader title="Aggregate Sale" subtitle="Record a quarry product delivery" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose Construction Material and a branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (!products) return <Loader />;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Aggregate Sale" subtitle="Record a quarry product delivery" />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-4">
          <div className="relative">
            <Field label="Truck" required>
              <button type="button" onClick={() => setShowTruckDrop((v) => !v)} className={`${inputCls} text-left bg-white`}>
                {selectedTruck ? `${selectedTruck.plateNumber} — ${selectedTruck.driverName}` : 'Choose truck...'}
              </button>
            </Field>
            {showTruckDrop && (
              <div className="absolute z-10 w-full bg-white border rounded shadow-lg mt-1 max-h-64 overflow-y-auto">
                {trucks.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No aggregate trucks available</p>}
                {trucks.map((t) => (
                  <button
                    key={t.id} type="button" disabled={t.busy}
                    onClick={() => { setVehicleId(t.id); setShowTruckDrop(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm border-b last:border-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <p>{t.plateNumber} — {t.driverName}</p>
                    <p className="text-xs text-gray-500">{t.driverPhone ? `(${t.driverPhone})` : ''}{t.busy ? ` ${t.busyReason}` : ''}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <Field label="Customer" required>
            {customer ? (
              <div className="flex items-center justify-between bg-brand-50 rounded px-3 py-2 text-sm">
                <span>{customer.name}{customer.phone ? ` — ${customer.phone}` : ''} · Balance: {formatMoney(customer.balance / 100)}</span>
                <button type="button" onClick={() => setCustomer(null)} className="text-xs text-gray-500 hover:text-gray-700">Change</button>
              </div>
            ) : (
              <div className="relative">
                <input type="text" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search customer..." className={inputCls} />
                {customerResults.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {customerResults.map((c) => (
                      <button
                        type="button" key={c.id}
                        onClick={() => { setCustomer(c); setCustomerQuery(''); setCustomerResults([]); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {c.name}{c.phone ? ` — ${c.phone}` : ''} · Bal: {formatMoney(c.balance / 100)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="font-semibold text-sm">Product</h3>
          <Field label="Quarry Product" required>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls} required>
              <option value="">Choose product...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.quarryName} — {p.size}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Actual Qty (tonnes)" required>
              <NumberInput value={actualQty} onChange={(e) => handleActualQtyChange(e.target.value)} placeholder="From quarry" />
            </Field>
            <Field label="Bill Qty (tonnes, optional)">
              <NumberInput value={billQty} onChange={(e) => handleBillQtyChange(e.target.value)} placeholder="Defaults to Actual Qty" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sell Price per Tonne">
              <NumberInput value={unitPrice} onChange={(e) => handleUnitPriceChange(e.target.value)} />
            </Field>
            <Field label="Total Amount">
              <NumberInput value={total} onChange={(e) => handleTotalChange(e.target.value)} />
            </Field>
          </div>
          {selectedProduct?.currentPrice != null && (
            <p className="text-xs text-gray-500">Quarry cost/tonne on file: {formatMoney(selectedProduct.currentPrice / 100)}</p>
          )}
        </Card>

        <Card className="p-4 grid sm:grid-cols-3 gap-4">
          <Field label="Discount">
            <NumberInput value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Transport Fee">
            <NumberInput value={transportFee} onChange={(e) => setTransportFee(e.target.value)} placeholder="0.00" />
          </Field>
          <div className="flex flex-col justify-end">
            <div className="bg-gray-50 rounded p-3 text-right">
              <p className="text-xs text-gray-500">Subtotal: {formatMoney(subtotal)}</p>
              <p className="text-lg font-bold">Total: {formatMoney(grandTotal)}</p>
            </div>
          </div>
        </Card>

        {creditWarning && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <p className="text-sm font-medium text-amber-800 mb-1">Credit limit exceeded</p>
            <p className="text-xs text-amber-800 mb-3">{creditWarning.error}</p>
            <div className="mb-3">
              <OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} />
            </div>
            <button type="button" onClick={() => submit(true, overridePin)} disabled={submitting || !overridePin} className="text-xs font-medium text-amber-900 underline disabled:opacity-50">
              Proceed anyway (this will be flagged for the owner)
            </button>
          </Card>
        )}

        <button type="submit" disabled={submitting} className={`w-full py-3 ${btnPrimaryCls}`}>
          {submitting ? 'Saving...' : 'Create Sale'}
        </button>
      </form>

      {showTransportWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-3 text-amber-600">Transport fee not entered</h2>
            <p className="text-sm text-gray-600 mb-4">You haven't entered a transport fee. That's fine if it's complimentary, but we want to make sure it wasn't missed by mistake.</p>
            <div className="space-y-3">
              <button type="button" onClick={() => setShowTransportWarning(false)} className="w-full px-4 py-2 border rounded text-sm hover:bg-gray-50 font-medium">
                Go back &amp; add transport fee
              </button>
              <button type="button" onClick={() => { setShowTransportWarning(false); submit(); }} disabled={submitting} className="w-full px-4 py-2 bg-amber-700 text-white rounded text-sm hover:bg-amber-800 font-medium disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Continue without fee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
