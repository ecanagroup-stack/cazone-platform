'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyState, Field, inputCls, btnPrimaryCls, OtpField, NumberInput,
} from '@/components/ui';
import { formatMoney } from '@/lib/format';

// Replaces the old single-product Cement Sale and Aggregate Sale pages with one cart: a customer can
// need both bags and tonnes on the same trip, so this adds items of either kind to one order rather
// than forcing two separate sales. Each item still sources stock the way it always did — cement sells
// down a picked ATC's qtyRemaining (lib/allocation.js), aggregate buys straight off the truck from the
// quarry (a "received" Delivery, not an allocation) — but now travels through one shared cart with its
// own transport fee and any number of labour/other costs, submitted together as one Order/OrderLines
// (see app/api/admin/materials/sales/route.js).
const emptyCostDraft = { type: 'labour', amount: '', detail: '' };

function ExtraCostsEditor({ costs, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyCostDraft);

  const add = () => {
    const amount = Number(draft.amount);
    if (!amount || amount <= 0) return toast.error('Enter a cost amount');
    onAdd({ id: Date.now(), type: draft.type, amount, detail: draft.detail.trim() });
    setDraft({ ...emptyCostDraft, type: draft.type });
  };

  return (
    <div className="border-t pt-3 mt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
        {open ? '− Hide labour / other costs' : '+ Add labour / other cost'}
      </button>

      {costs.length > 0 && (
        <div className="mt-2 space-y-1">
          {costs.map((c) => (
            <div key={c.id} className="flex justify-between items-center bg-gray-50 rounded px-2 py-1 text-xs">
              <span className="capitalize">{c.type}{c.detail ? ` — ${c.detail}` : ''}</span>
              <span className="flex items-center gap-2">
                {formatMoney(c.amount)}
                <button type="button" onClick={() => onRemove(c.id)} className="text-amber-700 hover:underline">Remove</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="grid grid-cols-3 gap-2 mt-2 items-end">
          <Field label="Type">
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className={inputCls}>
              <option value="labour">Labour</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Amount">
            <NumberInput value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          </Field>
          <Field label="Detail">
            <input type="text" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} className={inputCls} placeholder="What for?" />
          </Field>
          <button type="button" onClick={add} className="col-span-3 text-sm border rounded py-1.5 hover:bg-gray-50">+ Add cost</button>
        </div>
      )}
    </div>
  );
}

function costsTotal(costs) { return costs.reduce((s, c) => s + c.amount, 0); }

export default function NewMaterialsSalePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';

  const [atcs, setAtcs] = useState(null);
  const [brands, setBrands] = useState([]);
  const [aggregateProducts, setAggregateProducts] = useState([]);
  const [trucks, setTrucks] = useState([]);

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customer, setCustomer] = useState(null);

  const [itemKind, setItemKind] = useState('cement');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null);
  const [overridePin, setOverridePin] = useState('');
  const [pendingTransportWarning, setPendingTransportWarning] = useState(null); // holds the built item, awaiting confirm

  const load = useCallback(async () => {
    if (!serviceId) { setAtcs(null); return; }
    const [a, b, p, t] = await Promise.all([
      fetch(`/api/admin/materials/atcs?serviceId=${serviceId}&availableForSale=true`).then((r) => r.json()),
      fetch(`/api/admin/materials/cement-brands?serviceId=${serviceId}`).then((r) => r.json()),
      fetch(`/api/admin/materials/stonedust?serviceId=${serviceId}`).then((r) => r.json()),
      fetch('/api/admin/materials/trucks').then((r) => r.json()),
    ]);
    if (a.success) setAtcs(a.data); else toast.error(a.error || 'Failed to load ATCs');
    if (b.success) setBrands(b.data);
    if (p.success) setAggregateProducts(p.data);
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

  const addToCart = (item) => {
    if (!item.transportFee) { setPendingTransportWarning(item); return; }
    setCart((c) => [...c, item]);
  };

  const confirmAddWithoutTransport = () => {
    setCart((c) => [...c, pendingTransportWarning]);
    setPendingTransportWarning(null);
  };

  const removeFromCart = (id) => setCart((c) => c.filter((i) => i.id !== id));

  const subtotal = cart.reduce((s, i) => s + i.lineTotal, 0);
  const transportTotal = cart.reduce((s, i) => s + i.transportFee, 0);
  const labourTotal = cart.reduce((s, i) => s + costsTotal(i.costs.filter((c) => c.type === 'labour')), 0);
  const otherTotal = cart.reduce((s, i) => s + costsTotal(i.costs.filter((c) => c.type === 'other')), 0);
  const grandTotal = subtotal - (Number(discount) || 0) + transportTotal + labourTotal + otherTotal;

  const submit = async (overrideCredit = false, otp = '') => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, customerId: customer.id, discount: Number(discount) || 0,
          items: cart.map((i) => ({
            kind: i.kind, atcId: i.atcId, productId: i.productId, vehicleId: i.vehicleId,
            actualQty: i.actualQty, billQty: i.billQty, unitPrice: i.unitPrice,
            transportFee: i.transportFee, costs: i.costs.map((c) => ({ type: c.type, amount: c.amount, detail: c.detail })),
          })),
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
    if (cart.length === 0) return toast.error('Add at least one item');
    setCreditWarning(null);
    submit();
  };

  if (!serviceId || !branchId) {
    return (
      <div>
        <PageHeader title="New Sale" subtitle="Sell cement and aggregate together as one order" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose Construction Material and a branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (!atcs) return <Loader />;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="New Sale" subtitle="Add cement and/or aggregate items, then complete one sale" />

      <form onSubmit={handleSubmit} className="space-y-6">
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
                      <button type="button" key={c.id} onClick={() => { setCustomer(c); setCustomerQuery(''); setCustomerResults([]); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                        {c.name}{c.phone ? ` — ${c.phone}` : ''} · Bal: {formatMoney(c.balance / 100)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        </Card>

        <Card className="p-4">
          <div className="flex gap-2 mb-4">
            <button type="button" onClick={() => setItemKind('cement')} className={`flex-1 px-3 py-2 text-sm rounded border ${itemKind === 'cement' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white hover:bg-gray-50'}`}>Cement</button>
            <button type="button" onClick={() => setItemKind('aggregate')} className={`flex-1 px-3 py-2 text-sm rounded border ${itemKind === 'aggregate' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white hover:bg-gray-50'}`}>Aggregate</button>
          </div>
          {itemKind === 'cement'
            ? <AddCementItem atcs={atcs} brands={brands} cart={cart} onAdd={addToCart} />
            : <AddAggregateItem products={aggregateProducts} trucks={trucks} onAdd={addToCart} />}
        </Card>

        {cart.length > 0 && (
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">Sale Items ({cart.length})</h3>
            <div className="space-y-2">
              {cart.map((i) => (
                <div key={i.id} className="border rounded p-3 bg-gray-50">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">
                        <span className="uppercase text-[10px] tracking-wide bg-gray-200 rounded px-1.5 py-0.5 mr-2">{i.kind}</span>
                        {i.label}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Supplied: {i.actualQty.toLocaleString()} | Billed: {i.billQty.toLocaleString()} @ {formatMoney(i.unitPrice)}</p>
                      {i.transportFee > 0 && <p className="text-xs text-gray-500">Transport: {formatMoney(i.transportFee)}</p>}
                      {i.costs.map((c) => (
                        <p key={c.id} className="text-xs text-gray-500 capitalize">{c.type}{c.detail ? ` (${c.detail})` : ''}: {formatMoney(c.amount)}</p>
                      ))}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm">{formatMoney(i.lineTotal + i.transportFee + costsTotal(i.costs))}</p>
                      <button type="button" onClick={() => removeFromCart(i.id)} className="text-amber-700 text-xs hover:underline mt-1">Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4 space-y-3">
          <Field label="Discount">
            <NumberInput value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
          </Field>
          <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatMoney(subtotal)}</span></div>
            {Number(discount) > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span>-{formatMoney(Number(discount))}</span></div>}
            {transportTotal > 0 && <div className="flex justify-between"><span className="text-gray-500">Transport</span><span>{formatMoney(transportTotal)}</span></div>}
            {labourTotal > 0 && <div className="flex justify-between"><span className="text-gray-500">Labour</span><span>{formatMoney(labourTotal)}</span></div>}
            {otherTotal > 0 && <div className="flex justify-between"><span className="text-gray-500">Other Costs</span><span>{formatMoney(otherTotal)}</span></div>}
            <div className="flex justify-between font-bold border-t pt-1 text-base"><span>Total</span><span>{formatMoney(grandTotal)}</span></div>
          </div>
        </Card>

        {creditWarning && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <p className="text-sm font-medium text-amber-800 mb-1">Credit limit exceeded</p>
            <p className="text-xs text-amber-800 mb-3">{creditWarning.error}</p>
            <div className="mb-3"><OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} /></div>
            <button type="button" onClick={() => submit(true, overridePin)} disabled={submitting || !overridePin} className="text-xs font-medium text-amber-900 underline disabled:opacity-50">
              Proceed anyway (this will be flagged for the owner)
            </button>
          </Card>
        )}

        <button type="submit" disabled={submitting || cart.length === 0} className={`w-full py-3 ${btnPrimaryCls}`}>
          {submitting ? 'Submitting...' : 'Complete Sale'}
        </button>
      </form>

      {pendingTransportWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-3 text-amber-600">Transport fee not entered</h2>
            <p className="text-sm text-gray-600 mb-4">This item has no transport fee. That's fine if it's complimentary, but we want to make sure it wasn't missed by mistake.</p>
            <div className="space-y-3">
              <button type="button" onClick={() => setPendingTransportWarning(null)} className="w-full px-4 py-2 border rounded text-sm hover:bg-gray-50 font-medium">
                Go back &amp; add transport fee
              </button>
              <button type="button" onClick={confirmAddWithoutTransport} className="w-full px-4 py-2 bg-amber-700 text-white rounded text-sm hover:bg-amber-800 font-medium">
                Add item — Complimentary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddCementItem({ atcs, brands, cart, onAdd }) {
  const [brandFilter, setBrandFilter] = useState('');
  const [selectedAtcId, setSelectedAtcId] = useState('');
  const [showAtcDrop, setShowAtcDrop] = useState(false);
  const [qty, setQty] = useState('');
  const [billQty, setBillQty] = useState('');
  const [price, setPrice] = useState('');
  const [transportFee, setTransportFee] = useState('');
  const [costs, setCosts] = useState([]);

  const selectedAtc = atcs.find((a) => a.id === selectedAtcId);
  const sortedAtcs = atcs
    .filter((a) => !brandFilter || a.productId === brandFilter)
    .slice()
    .sort((x, y) => {
      const priority = { arrived: 0, loaded: 1 };
      const px = priority[x.status] ?? 2, py = priority[y.status] ?? 2;
      if (px !== py) return px - py;
      return new Date(x.arrivalDate || x.loadedAt || x.createdAt) - new Date(y.arrivalDate || y.loadedAt || y.createdAt);
    });

  const formatAtcNumber = (atc) => `${atc.product?.abbreviation || '???'}-${atc.atcNumber}`;
  const alreadyInCart = cart.filter((i) => i.kind === 'cement' && i.atcId === selectedAtcId).reduce((s, i) => s + i.actualQty, 0);
  const bagsRemaining = selectedAtc ? selectedAtc.qtyRemaining - alreadyInCart : 0;

  const reset = () => { setQty(''); setBillQty(''); setPrice(''); setTransportFee(''); setCosts([]); };

  const handleAdd = () => {
    if (!selectedAtc) return toast.error('Select an ATC');
    if (!qty || !price) return toast.error('Enter quantity and price');
    const actualQty = Number(qty);
    const billed = billQty ? Number(billQty) : actualQty;
    const unitPrice = Number(price);
    if (actualQty <= 0 || actualQty > bagsRemaining) return toast.error(`Can only add up to ${bagsRemaining.toLocaleString()} bags remaining on this ATC`);

    onAdd({
      id: Date.now(), kind: 'cement', atcId: selectedAtc.id,
      label: `${selectedAtc.product?.name || 'Cement'} — ${formatAtcNumber(selectedAtc)}`,
      actualQty, billQty: billed, unitPrice, lineTotal: billed * unitPrice,
      transportFee: Number(transportFee) || 0, costs,
    });
    reset();
    toast.success('Item added');
  };

  return (
    <div className="space-y-4">
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
              ? `${selectedAtc.vehicle?.plateNumber || 'No truck'} — ${selectedAtc.qtyRemaining.toLocaleString()} bags — ${formatAtcNumber(selectedAtc)}`
              : 'Choose truck / ATC...'}
          </button>
        </Field>
        {showAtcDrop && (
          <div className="absolute z-10 w-full bg-white border rounded shadow-lg mt-1 max-h-64 overflow-y-auto">
            {sortedAtcs.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No loaded or arrived ATCs available</p>}
            {sortedAtcs.map((a) => (
              <button key={a.id} type="button" onClick={() => { setSelectedAtcId(a.id); setShowAtcDrop(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm border-b last:border-0">
                <p>{a.vehicle?.plateNumber || 'No truck'} — {a.qtyRemaining.toLocaleString()} bags left</p>
                <p className="text-xs text-gray-500">{formatAtcNumber(a)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAtc && (
        <p className={`text-sm font-medium ${bagsRemaining <= 0 ? 'text-amber-700' : 'text-green-700'}`}>Remaining: {bagsRemaining.toLocaleString()} bags</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="Qty Supplied"><NumberInput value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Bags" /></Field>
        <Field label="Bill Qty (optional)"><NumberInput value={billQty} onChange={(e) => setBillQty(e.target.value)} placeholder="= Qty" /></Field>
        <Field label="Price/Bag"><NumberInput value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </div>
      <Field label="Transport Fee"><NumberInput value={transportFee} onChange={(e) => setTransportFee(e.target.value)} placeholder="0 if complimentary" /></Field>

      <ExtraCostsEditor costs={costs} onAdd={(c) => setCosts((cs) => [...cs, c])} onRemove={(id) => setCosts((cs) => cs.filter((c) => c.id !== id))} />

      <button type="button" onClick={handleAdd} disabled={!selectedAtc || bagsRemaining <= 0} className={`w-full ${btnPrimaryCls}`}>Add to Sale</button>
    </div>
  );
}

function AddAggregateItem({ products, trucks, onAdd }) {
  const [vehicleId, setVehicleId] = useState('');
  const [showTruckDrop, setShowTruckDrop] = useState(false);
  const [productId, setProductId] = useState('');
  const [actualQty, setActualQty] = useState('');
  const [billQty, setBillQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [total, setTotal] = useState('');
  const [transportFee, setTransportFee] = useState('');
  const [costs, setCosts] = useState([]);

  const selectedTruck = trucks.find((t) => t.id === vehicleId);
  const selectedProduct = products.find((p) => p.id === productId);
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

  const reset = () => {
    setActualQty(''); setBillQty(''); setUnitPrice(''); setTotal(''); setTransportFee(''); setCosts([]);
  };

  const handleAdd = () => {
    if (!selectedTruck) return toast.error('Select a truck');
    if (!productId || !actualQty || !unitPrice) return toast.error('Select product, quantity and price');
    const qty = Number(actualQty);
    const billed = Number(effectiveBillQty);
    const price = Number(unitPrice);

    onAdd({
      id: Date.now(), kind: 'aggregate', productId, vehicleId,
      label: `${selectedProduct.quarryName} — ${selectedProduct.size}`,
      actualQty: qty, billQty: billed, unitPrice: price, lineTotal: billed * price,
      transportFee: Number(transportFee) || 0, costs,
    });
    setVehicleId(''); setProductId('');
    reset();
    toast.success('Item added');
  };

  return (
    <div className="space-y-4">
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
              <button key={t.id} type="button" disabled={t.busy} onClick={() => { setVehicleId(t.id); setShowTruckDrop(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm border-b last:border-0 disabled:opacity-40 disabled:cursor-not-allowed">
                <p>{t.plateNumber} — {t.driverName}</p>
                <p className="text-xs text-gray-500">{t.busy ? t.busyReason : ''}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <Field label="Quarry Product" required>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls} required>
          <option value="">Choose product...</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.quarryName} — {p.size}</option>)}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Actual Qty (tonnes)" required><NumberInput value={actualQty} onChange={(e) => handleActualQtyChange(e.target.value)} placeholder="From quarry" /></Field>
        <Field label="Bill Qty (tonnes, optional)"><NumberInput value={billQty} onChange={(e) => handleBillQtyChange(e.target.value)} placeholder="Defaults to Actual Qty" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sell Price per Tonne"><NumberInput value={unitPrice} onChange={(e) => handleUnitPriceChange(e.target.value)} /></Field>
        <Field label="Total Amount"><NumberInput value={total} onChange={(e) => handleTotalChange(e.target.value)} /></Field>
      </div>
      {selectedProduct?.currentPrice != null && (
        <p className="text-xs text-gray-500">Quarry cost/tonne on file: {formatMoney(selectedProduct.currentPrice / 100)}</p>
      )}

      <Field label="Transport Fee"><NumberInput value={transportFee} onChange={(e) => setTransportFee(e.target.value)} placeholder="0 if complimentary" /></Field>

      <ExtraCostsEditor costs={costs} onAdd={(c) => setCosts((cs) => [...cs, c])} onRemove={(id) => setCosts((cs) => cs.filter((c) => c.id !== id))} />

      <button type="button" onClick={handleAdd} className={`w-full ${btnPrimaryCls}`}>Add to Sale</button>
    </div>
  );
}
