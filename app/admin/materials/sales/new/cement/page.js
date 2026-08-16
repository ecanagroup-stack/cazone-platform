'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyState, Field, inputCls, btnPrimaryCls, OtpField, NumberInput,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';

// Ported from ecana_shop-app's app/admin/sales/new/cement/page.js — a truck/ATC picker, then
// per-customer "distributions" added one at a time (qty supplied / bill qty / price/bag, each
// independently priced — this is a negotiated wholesale sale, not a fixed-catalog-price counter),
// submitted as one order per customer against the shared ATC. Bags supplied vs. billed and the
// transport-fee-left-blank confirmation are both faithfully carried over (lib/sale.js's
// stockQty/unitPrice-override support and Order.transportFee exist specifically for this flow).
export default function NewCementSalePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';

  const [atcs, setAtcs] = useState(null);
  const [brands, setBrands] = useState([]);
  const [brandFilter, setBrandFilter] = useState('');
  const [selectedAtcId, setSelectedAtcId] = useState('');
  const [showAtcDrop, setShowAtcDrop] = useState(false);

  const [distributions, setDistributions] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [formCustomer, setFormCustomer] = useState(null);
  const [formQty, setFormQty] = useState('');
  const [formBillQty, setFormBillQty] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const [transportFee, setTransportFee] = useState('');
  const [showTransportWarning, setShowTransportWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null); // { distIndex, error }
  const [overridePin, setOverridePin] = useState('');

  const load = useCallback(async () => {
    if (!serviceId) { setAtcs(null); return; }
    const [a, b] = await Promise.all([
      fetch(`/api/admin/materials/atcs?serviceId=${serviceId}&availableForSale=true`).then((r) => r.json()),
      fetch(`/api/admin/materials/cement-brands?serviceId=${serviceId}`).then((r) => r.json()),
    ]);
    if (a.success) setAtcs(a.data); else toast.error(a.error || 'Failed to load');
    if (b.success) setBrands(b.data);
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

  const selectedAtc = (atcs || []).find((a) => a.id === selectedAtcId);
  const sortedAtcs = (atcs || [])
    .filter((a) => !brandFilter || a.productId === brandFilter)
    .slice()
    .sort((x, y) => {
      const priority = { arrived: 0, loaded: 1 };
      const px = priority[x.status] ?? 2, py = priority[y.status] ?? 2;
      if (px !== py) return px - py;
      return new Date(x.arrivalDate || x.loadedAt || x.createdAt) - new Date(y.arrivalDate || y.loadedAt || y.createdAt);
    });

  const totalBagsDistributed = distributions.reduce((s, d) => s + d.actualQty, 0);
  const bagsRemaining = selectedAtc ? selectedAtc.qtyRemaining - totalBagsDistributed : 0;

  const formatAtcNumber = (atc) => `${atc.product?.abbreviation || '???'}-${atc.atcNumber}`;
  const formatStatusHours = (atc) => {
    const arrived = atc.status === 'arrived';
    const since = arrived ? atc.arrivalDate : atc.loadedAt;
    const label = arrived ? 'Arrived' : 'Loaded';
    if (!since) return label;
    const hours = Math.floor((Date.now() - new Date(since)) / (60 * 60 * 1000));
    if (hours >= 24) { const days = Math.floor(hours / 24); return `${label} (${days}d)`; }
    return `${label} (${hours <= 0 ? '<1' : hours}h)`;
  };

  const addDistribution = () => {
    if (!formCustomer) return toast.error('Select a customer');
    if (!formQty || !formPrice) return toast.error('Enter quantity and price');
    const actualQty = Number(formQty);
    const billQty = formBillQty ? Number(formBillQty) : actualQty;
    const price = Number(formPrice);
    if (actualQty <= 0 || actualQty > bagsRemaining) return toast.error(`Can only distribute up to ${bagsRemaining.toLocaleString()} bags remaining`);

    setDistributions([...distributions, {
      id: Date.now(), customerId: formCustomer.id, customerName: formCustomer.name,
      actualQty, billQty, price, total: billQty * price, notes: formNotes,
    }]);
    setFormCustomer(null); setCustomerQuery(''); setCustomerResults([]);
    setFormQty(''); setFormBillQty(''); setFormPrice(''); setFormNotes('');
    toast.success('Customer added');
  };

  const removeDistribution = (id) => setDistributions(distributions.filter((d) => d.id !== id));

  const submitOne = async (dist, overrideCredit = false, otp = '') => {
    const r = await fetch('/api/admin/materials/sales/cement', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        atcId: selectedAtc.id, customerId: dist.customerId,
        billQty: dist.billQty, actualQty: dist.actualQty, unitPrice: dist.price,
        transportFee: Number(transportFee) || 0, overrideCredit, otp,
      }),
    });
    return r.json();
  };

  const proceedWithSubmit = async () => {
    setShowTransportWarning(false);
    setSubmitting(true);
    try {
      for (let i = 0; i < distributions.length; i++) {
        const dist = distributions[i];
        const d = await submitOne(dist);
        if (d.needsApproval) {
          setCreditWarning({ index: i, ...d });
          return; // stop the loop — resolve this one (approve or cancel) before continuing
        }
        if (!d.success) throw new Error(`Failed for ${dist.customerName}: ${d.error}`);
      }
      toast.success(`Recorded ${distributions.length} sale${distributions.length === 1 ? '' : 's'}`);
      router.push('/admin/materials/atcs');
    } catch (err) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverrideAndContinue = async () => {
    setSubmitting(true);
    try {
      const dist = distributions[creditWarning.index];
      const d = await submitOne(dist, true, overridePin);
      if (!d.success) { toast.error(d.error); return; }
      setCreditWarning(null); setOverridePin('');
      // Resubmit the remaining distributions after this one.
      for (let i = creditWarning.index + 1; i < distributions.length; i++) {
        const next = distributions[i];
        const nd = await submitOne(next);
        if (nd.needsApproval) { setCreditWarning({ index: i, ...nd }); return; }
        if (!nd.success) throw new Error(`Failed for ${next.customerName}: ${nd.error}`);
      }
      toast.success(`Recorded ${distributions.length} sale${distributions.length === 1 ? '' : 's'}`);
      router.push('/admin/materials/atcs');
    } catch (err) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedAtc) return toast.error('Select an ATC');
    if (distributions.length === 0) return toast.error('Add at least one customer');
    if (!transportFee || transportFee === '0') { setShowTransportWarning(true); return; }
    proceedWithSubmit();
  };

  if (!serviceId || !branchId) {
    return (
      <div>
        <PageHeader title="Cement Sale" subtitle="Distribute an ATC's bags across one or more customers" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose Construction Material and a branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (!atcs) return <Loader />;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Cement Sale" subtitle="Distribute an ATC's bags across one or more customers" />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-4 space-y-4">
          <Field label="Filter by brand (optional)">
            <select value={brandFilter} onChange={(e) => { setBrandFilter(e.target.value); setSelectedAtcId(''); }} className={inputCls}>
              <option value="">All Brands</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.attributes?.grade ? ` (${b.attributes.grade})` : ''}</option>)}
            </select>
          </Field>

          <div className="relative">
            <Field label="Truck / ATC" required>
              <button type="button" onClick={() => setShowAtcDrop((v) => !v)} className={`${inputCls} text-left bg-white`}>
                {selectedAtc
                  ? `${selectedAtc.vehicle?.plateNumber || 'No truck'} — ${formatStatusHours(selectedAtc)} (${selectedAtc.qtyRemaining.toLocaleString()} bags) — ${formatAtcNumber(selectedAtc)}`
                  : 'Choose truck / ATC...'}
              </button>
            </Field>
            {showAtcDrop && (
              <div className="absolute z-10 w-full bg-white border rounded shadow-lg mt-1 max-h-64 overflow-y-auto">
                {sortedAtcs.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No loaded or arrived ATCs available</p>}
                {sortedAtcs.map((a) => (
                  <button
                    key={a.id} type="button"
                    onClick={() => { setSelectedAtcId(a.id); setShowAtcDrop(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm border-b last:border-0"
                  >
                    <p>{a.vehicle?.plateNumber || 'No truck'} — {formatStatusHours(a)} · {a.qtyRemaining.toLocaleString()} bags left</p>
                    <p className="text-xs text-gray-500">{formatAtcNumber(a)}{a.vehicle?.driverPhone ? ` (${a.vehicle.driverPhone})` : ''}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedAtc && (
            <div className="bg-green-50 border border-green-300 rounded p-3 space-y-1 text-sm">
              <p><span className="font-medium">Brand:</span> {selectedAtc.product?.name}</p>
              <p><span className="font-medium">Total bags in ATC:</span> {selectedAtc.quantity.toLocaleString()}</p>
              <p className={`font-medium ${bagsRemaining <= 0 ? 'text-amber-700' : 'text-green-700'}`}>Remaining: {bagsRemaining.toLocaleString()} bags</p>
            </div>
          )}
        </Card>

        {selectedAtc && bagsRemaining > 0 && (
          <Card className="p-4 space-y-4">
            <h3 className="font-semibold text-sm">Add Customer Distribution</h3>

            <div className="relative">
              <Field label="Customer" required>
                {formCustomer ? (
                  <div className="flex items-center justify-between bg-brand-50 rounded px-3 py-2 text-sm">
                    <span>{formCustomer.name}{formCustomer.phone ? ` — ${formCustomer.phone}` : ''}</span>
                    <button type="button" onClick={() => setFormCustomer(null)} className="text-xs text-gray-500 hover:text-gray-700">Remove</button>
                  </div>
                ) : (
                  <input type="text" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search customer..." className={inputCls} />
                )}
              </Field>
              {!formCustomer && customerResults.length > 0 && (
                <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {customerResults.map((c) => (
                    <button
                      type="button" key={c.id}
                      onClick={() => { setFormCustomer(c); setCustomerQuery(''); setCustomerResults([]); }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {c.name}{c.phone ? ` — ${c.phone}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <Field label="Qty Supplied">
                <NumberInput value={formQty} onChange={(e) => setFormQty(e.target.value)} placeholder="Bags" />
              </Field>
              <Field label="Bill Qty (optional)">
                <NumberInput value={formBillQty} onChange={(e) => setFormBillQty(e.target.value)} placeholder="= Qty" />
              </Field>
              <Field label="Price/Bag">
                <NumberInput value={formPrice} onChange={(e) => setFormPrice(e.target.value)} />
              </Field>
              <Field label="Total">
                <div className={`${inputCls} bg-gray-50 font-medium`}>
                  {formQty && formPrice ? formatMoney(Number(formBillQty || formQty) * Number(formPrice)) : '—'}
                </div>
              </Field>
            </div>

            <Field label="Notes (optional)">
              <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className={inputCls} placeholder="Delivery notes..." />
            </Field>

            <button type="button" onClick={addDistribution} className={`w-full ${btnPrimaryCls}`}>Add Sale</button>
          </Card>
        )}

        {distributions.length > 0 && (
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">Distribution Summary ({distributions.length} customer{distributions.length === 1 ? '' : 's'})</h3>
            <div className="space-y-2">
              {distributions.map((d) => (
                <div key={d.id} className="border rounded p-3 bg-gray-50 flex justify-between items-start">
                  <div>
                    <p className="font-medium text-sm">{d.customerName}</p>
                    <p className="text-xs text-gray-500">Supplied: {d.actualQty.toLocaleString()} bags | Billed: {d.billQty.toLocaleString()} bags</p>
                    <p className="text-xs text-gray-500">Price: {formatMoney(d.price)}/bag</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm">{formatMoney(d.total)}</p>
                    <button type="button" onClick={() => removeDistribution(d.id)} className="text-amber-700 text-xs hover:underline mt-1">Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-1 text-sm">
              <p><span className="font-medium">Total bags distributed:</span> {totalBagsDistributed.toLocaleString()} / {selectedAtc?.quantity.toLocaleString()}</p>
              <p><span className="font-medium">Total amount:</span> {formatMoney(distributions.reduce((s, d) => s + d.total, 0))}</p>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <Field label="Transport Fee">
            <NumberInput value={transportFee} onChange={(e) => setTransportFee(e.target.value)} placeholder="0 if complimentary" />
          </Field>
          <p className="text-xs text-gray-500 mt-1">Leave empty or 0 if transportation is complimentary — added to every distribution's total, not split between them.</p>
        </Card>

        {creditWarning && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <p className="text-sm font-medium text-amber-800 mb-1">Credit limit exceeded for {distributions[creditWarning.index]?.customerName}</p>
            <p className="text-xs text-amber-800 mb-3">{creditWarning.error}</p>
            <div className="mb-3">
              <OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} />
            </div>
            <button type="button" onClick={handleOverrideAndContinue} disabled={submitting || !overridePin} className="text-xs font-medium text-amber-900 underline disabled:opacity-50">
              Proceed anyway (this will be flagged for the owner)
            </button>
          </Card>
        )}

        <button type="submit" disabled={submitting || !selectedAtc || distributions.length === 0} className={`w-full py-3 ${btnPrimaryCls}`}>
          {submitting ? 'Submitting...' : 'Submit'}
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
              <button type="button" onClick={proceedWithSubmit} disabled={submitting} className="w-full px-4 py-2 bg-amber-700 text-white rounded text-sm hover:bg-amber-800 font-medium disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Continue without fee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
