'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyState, EmptyRow, Modal, FormButtons, Field, Tabs, StatusPill,
  inputCls, btnPrimaryCls, tableActionCls, tableDangerActionCls, theadCls, tableScrollCls,
  OtpField, NumberInput, CustomerNameField,
} from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const TABS = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'sell', label: 'Record Sale' },
  { key: 'history', label: 'Sales History' },
  { key: 'manage', label: 'Manage Products' },
];

// Ported from ecana_shop-app's app/admin/shop/page.js — the retail counter for plain shop items
// (cement/aggregate have their own dedicated sale flows). Unlike the old app's siloed
// ShopProduct.stockQuantity, on-hand here is the same live StockMove ledger every other pack already
// uses (lib/stock.js) — Manage Products and Inventory are two views over the same
// /api/admin/materials/products data, not separate models. The old app's "selling cement to a
// sentinel Shop customer auto-restocks the warehouse" mechanism was deliberately not ported (a
// secondary convenience on top of the core 4-tab flow, not requested) — stock only ever moves here
// via checkout or the Inventory tab's "Add Stock In".
export default function CementWarehousePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';
  const activeTab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'inventory';

  const setTab = (key) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === 'inventory') params.delete('tab'); else params.set('tab', key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (!serviceId || !branchId) {
    return (
      <div>
        <PageHeader title="Cement Warehouse" subtitle="Retail counter — its own products, stock, and walk-in sales" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose Construction Material and a branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Cement Warehouse" subtitle="Retail counter — its own products, stock, and walk-in sales" />
      <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      {activeTab === 'inventory' && <InventoryTab serviceId={serviceId} branchId={branchId} />}
      {activeTab === 'sell' && <RecordSaleTab serviceId={serviceId} branchId={branchId} onSold={() => setTab('history')} />}
      {activeTab === 'history' && <SalesHistoryTab branchId={branchId} />}
      {activeTab === 'manage' && <ManageProductsTab serviceId={serviceId} branchId={branchId} />}
    </div>
  );
}

// Cement brands (abbreviation set) and aggregate (supplierId set) are M1's dedicated pages —
// this counter is only for plain shop items, so it filters those out of the shared products list.
function useProducts(serviceId, branchId) {
  const [products, setProducts] = useState(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/materials/products?serviceId=${serviceId}&branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setProducts(d.data.filter((p) => !p.abbreviation && !p.supplierId));
    else toast.error(d.error || 'Failed to load products');
  }, [serviceId, branchId]);
  useEffect(() => { load(); }, [load]);
  return [products, load];
}

// Shared by the Inventory tab's "Add Stock In" and Manage Products' "Add Stock" — same manual,
// no-supplier receipt (any source: a supplier delivery, a stocktake correction, whatever the
// Description note says), just opened from two different places. A plain StockMove, same as either
// call site always did (see app/api/admin/materials/products/[id]/stock-in).
function StockInModal({ open, onClose, products, branchId, onAdded, initialProductId = '' }) {
  const [form, setForm] = useState({ productId: initialProductId, quantity: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) setForm({ productId: initialProductId, quantity: '', description: '' }); }, [open, initialProductId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/materials/products/${form.productId}/stock-in`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, quantity: Number(form.quantity), description: form.description }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Stock added'); onAdded(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Stock In">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Product" required>
          <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={inputCls} required>
            <option value="">Choose product...</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" required>
            <NumberInput value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          </Field>
          <Field label="Description">
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="Source / supplier / note" />
          </Field>
        </div>
        <FormButtons onCancel={onClose} submitting={submitting} submitLabel="Add Stock" />
      </form>
    </Modal>
  );
}

function InventoryTab({ serviceId, branchId }) {
  const [products, load] = useProducts(serviceId, branchId);
  const [showStockIn, setShowStockIn] = useState(false);

  if (!products) return <Loader />;
  const totalStock = products.reduce((s, p) => s + (p.onHand || 0), 0);

  return (
    <div>
      <div className="flex items-start gap-4 mb-4">
        <Card className="p-4 max-w-xs">
          <p className="text-xs text-gray-500">Total Stock</p>
          <p className="text-2xl font-bold mt-1">{totalStock.toLocaleString()}</p>
        </Card>
        <div className="flex items-center">
          <button onClick={() => setShowStockIn(true)} className={btnPrimaryCls}>Add Stock In</button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Product</th>
                <th className="px-4 py-3 text-right font-medium">In Stock</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.length === 0 && <EmptyRow colSpan={3} text="No shop products yet — add one under Manage Products" />}
              {products.map((p) => (
                <tr key={p.id} className={p.onHand === 0 ? 'bg-amber-50' : ''}>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className={`px-4 py-3 text-right font-bold ${p.onHand === 0 ? 'text-amber-700' : 'text-green-600'}`}>{(p.onHand || 0).toLocaleString()} {p.unit}</td>
                  <td className="px-4 py-3 text-right">{p.currentPrice != null ? formatMoney(p.currentPrice / 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <StockInModal open={showStockIn} onClose={() => setShowStockIn(false)} products={products} branchId={branchId} onAdded={() => { setShowStockIn(false); load(); }} />
    </div>
  );
}

function RecordSaleTab({ serviceId, branchId, onSold }) {
  const [products] = useProducts(serviceId, branchId);

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '' });
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerNameDuplicate, setNewCustomerNameDuplicate] = useState(null);

  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cart, setCart] = useState([]);
  const [cartProductId, setCartProductId] = useState('');
  const [cartQty, setCartQty] = useState('');
  const [cartBillQty, setCartBillQty] = useState('');
  const [cartPrice, setCartPrice] = useState('');

  const [transportHandledBy, setTransportHandledBy] = useState('');
  const [transportMeans, setTransportMeans] = useState('');
  const [transportPrice, setTransportPrice] = useState('');
  const [showTransportWarning, setShowTransportWarning] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null);
  const [overridePin, setOverridePin] = useState('');
  const [lastOrder, setLastOrder] = useState(null);

  // A walk-in sale can never be moved to an account.
  useEffect(() => { if (!customer && paymentMethod === 'credit') setPaymentMethod('cash'); }, [customer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (customerQuery.trim().length < 2) { setCustomerResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(customerQuery)}&branchId=${branchId}`);
      const d = await r.json();
      if (d.success) setCustomerResults(d.data);
    }, 250);
    return () => clearTimeout(t);
  }, [customerQuery, branchId]);

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (newCustomerNameDuplicate) return toast.error(`A customer named "${newCustomerNameDuplicate.name}" already exists — use a different name, or add something to distinguish this one`);
    setCreatingCustomer(true);
    try {
      const r = await fetch('/api/admin/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newCustomerForm, branchId }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(`${d.data.name} added`);
        setCustomer(d.data); setShowNewCustomer(false); setNewCustomerForm({ name: '', phone: '' });
        setCustomerQuery(''); setCustomerResults([]);
      } else toast.error(d.error);
    } finally {
      setCreatingCustomer(false);
    }
  };

  const addToCart = () => {
    const product = (products || []).find((p) => p.id === cartProductId);
    if (!product) return toast.error('Select a product');
    const qty = Number(cartQty);
    if (!qty || qty <= 0) return toast.error('Enter a valid quantity');
    if (qty > (product.onHand || 0)) return toast.error(`Only ${(product.onHand || 0).toLocaleString()} ${product.unit} in stock`);
    const billQty = cartBillQty ? Number(cartBillQty) : qty;
    if (!billQty || billQty <= 0) return toast.error('Enter a valid bill quantity');
    const price = cartPrice ? Number(cartPrice) : (product.currentPrice || 0) / 100;

    setCart((c) => [...c, { id: Date.now(), productId: product.id, name: product.name, unit: product.unit, qty, billQty, price, total: billQty * price }]);
    setCartProductId(''); setCartQty(''); setCartBillQty(''); setCartPrice('');
  };

  const removeFromCart = (id) => setCart((c) => c.filter((l) => l.id !== id));
  const cartTotal = cart.reduce((s, l) => s + l.total, 0);

  const submit = async (overrideCredit = false, otp = '') => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/shop/sale', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, customerId: customer?.id || null, paymentMethod,
          lines: cart.map((l) => ({ productId: l.productId, qty: l.qty, billQty: l.billQty, unitPrice: l.price })),
          transportFee: transportHandledBy === 'us' ? (Number(transportPrice) || 0) : 0,
          overrideCredit, otp,
        }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(`Sale ${d.data.order.orderNumber} recorded`);
        setLastOrder(d.data.order);
        setCart([]); setCustomer(null); setCustomerQuery(''); setPaymentMethod('cash');
        setTransportHandledBy(''); setTransportMeans(''); setTransportPrice('');
        setCreditWarning(null); setOverridePin('');
        onSold();
      } else if (d.needsApproval) {
        setCreditWarning(d);
      } else {
        toast.error(d.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const attemptSubmit = () => {
    if (cart.length === 0) return toast.error('Add at least one item');
    if (!transportHandledBy) return toast.error('State who is handling transport');
    if (transportHandledBy === 'us') {
      if (!transportMeans.trim()) return toast.error('State the means of transport');
      if (transportPrice === '') { setShowTransportWarning(true); return; }
    }
    setCreditWarning(null);
    submit();
  };

  if (!products) return <Loader />;

  return (
    <div className="max-w-2xl space-y-6">
      {lastOrder && (
        <Card className="p-3 flex items-center justify-between bg-green-50 border-green-200">
          <p className="text-sm text-green-800">Sale <span className="font-semibold">{lastOrder.orderNumber}</span> recorded.</p>
          <div className="flex items-center gap-4">
            <Link href={`/admin/orders/${lastOrder.id}/receipt`} target="_blank" className="text-sm font-medium text-brand-600 hover:text-brand-700">View Receipt</Link>
            <button onClick={() => setLastOrder(null)} className="text-xs text-gray-500 hover:text-gray-700">Dismiss</button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <Field label="Customer">
          {customer ? (
            <div className="flex items-center justify-between bg-brand-50 rounded px-3 py-2 text-sm">
              <span>{customer.name}{customer.phone ? ` — ${customer.phone}` : ''} · Bal: {formatMoney(customer.balance / 100)}</span>
              <button onClick={() => setCustomer(null)} className="text-xs text-gray-500 hover:text-gray-700">Change</button>
            </div>
          ) : (
            <div className="relative">
              <input type="text" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search customer, or leave blank for walk-in" className={inputCls} />
              {(customerResults.length > 0 || customerQuery.trim().length >= 2) && (
                <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {customerResults.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setCustomer(c); setCustomerQuery(''); setCustomerResults([]); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                      {c.name}{c.phone ? ` — ${c.phone}` : ''}
                    </button>
                  ))}
                  {customerQuery.trim().length >= 2 && (
                    <button type="button" onClick={() => { setNewCustomerForm({ name: customerQuery, phone: '' }); setNewCustomerNameDuplicate(null); setShowNewCustomer(true); }} className="block w-full text-left px-3 py-2 text-sm text-brand-600 hover:bg-brand-50 border-t">
                      + New customer "{customerQuery}"
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </Field>
      </Card>

      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium">Payment</p>
        {!customer ? (
          <>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
              <option value="cash">Cash</option>
              <option value="transfer">Bank Transfer</option>
              <option value="pos">POS</option>
              <option value="cheque">Cheque</option>
            </select>
            <p className="text-xs text-gray-500">Walk-in sales are paid for immediately — there's no account to add a balance to.</p>
          </>
        ) : (
          <>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="shopPaymentMode" checked={paymentMethod !== 'credit'} onChange={() => setPaymentMethod('cash')} />
                Pay Now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="shopPaymentMode" checked={paymentMethod === 'credit'} onChange={() => setPaymentMethod('credit')} />
                Move to Account
              </label>
            </div>
            {paymentMethod !== 'credit' ? (
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
                <option value="cash">Cash</option>
                <option value="transfer">Bank Transfer</option>
                <option value="pos">POS</option>
                <option value="cheque">Cheque</option>
              </select>
            ) : (
              <p className="text-xs text-gray-500">This sale will be added to {customer.name}'s account balance (current: {formatMoney(customer.balance / 100)}).</p>
            )}
          </>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-medium text-sm">Add Item</h3>
        <select
          value={cartProductId}
          onChange={(e) => { setCartProductId(e.target.value); const p = products.find((x) => x.id === e.target.value); if (p?.currentPrice != null) setCartPrice((p.currentPrice / 100).toString()); }}
          className={inputCls}
        >
          <option value="">Choose product...</option>
          {products.filter((p) => (p.onHand || 0) > 0).map((p) => <option key={p.id} value={p.id}>{p.name} ({(p.onHand || 0).toLocaleString()} {p.unit} left)</option>)}
        </select>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Qty (Supplied)"><NumberInput value={cartQty} onChange={(e) => setCartQty(e.target.value)} /></Field>
          <Field label="Bill Qty (optional)"><NumberInput value={cartBillQty} onChange={(e) => setCartBillQty(e.target.value)} placeholder="Defaults to Qty" /></Field>
          <Field label="Price"><NumberInput value={cartPrice} onChange={(e) => setCartPrice(e.target.value)} /></Field>
        </div>
        <button type="button" onClick={addToCart} className={`w-full ${btnPrimaryCls}`}>Add to Sale</button>
      </Card>

      {cart.length > 0 && (
        <Card className="p-4 space-y-2">
          <h3 className="font-medium text-sm mb-2">Cart</h3>
          {cart.map((l) => (
            <div key={l.id} className="flex justify-between items-center bg-gray-50 p-2 rounded text-sm">
              <div>
                <p className="font-medium">{l.name}</p>
                <p className="text-xs text-gray-500">Supplied: {l.qty} {l.unit} | Billed: {l.billQty} {l.unit}</p>
                <p className="text-xs text-gray-500">{formatMoney(l.price)}/{l.unit} = {formatMoney(l.total)}</p>
              </div>
              <button onClick={() => removeFromCart(l.id)} className="text-amber-700 text-xs hover:underline">Remove</button>
            </div>
          ))}
          <div className="border-t pt-2 text-right font-bold">Total: {formatMoney(cartTotal)}</div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <p className="text-sm font-medium">Transport</p>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="transportHandledBy" checked={transportHandledBy === 'customer'} onChange={() => { setTransportHandledBy('customer'); setTransportMeans(''); setTransportPrice(''); }} />
            Customer arranges their own transport
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="transportHandledBy" checked={transportHandledBy === 'us'} onChange={() => setTransportHandledBy('us')} />
            We handle transport
          </label>
        </div>
        {transportHandledBy === 'us' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Means of transport"><input type="text" value={transportMeans} onChange={(e) => setTransportMeans(e.target.value)} placeholder="e.g., Company truck" className={inputCls} /></Field>
            <Field label="Transport price"><NumberInput value={transportPrice} onChange={(e) => setTransportPrice(e.target.value)} placeholder="0 if complimentary" /></Field>
          </div>
        )}
      </Card>

      {creditWarning && (
        <Card className="p-4 border-amber-300 bg-amber-50">
          <p className="text-sm font-medium text-amber-800 mb-1">Credit limit exceeded</p>
          <p className="text-xs text-amber-800 mb-3">{creditWarning.error}</p>
          <div className="mb-3"><OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} /></div>
          <button onClick={() => submit(true, overridePin)} disabled={submitting || !overridePin} className="text-xs font-medium text-amber-900 underline disabled:opacity-50">
            Proceed anyway (this will be flagged for the owner)
          </button>
        </Card>
      )}

      <button onClick={attemptSubmit} disabled={submitting || cart.length === 0} className={`w-full py-3 font-bold ${btnPrimaryCls}`}>
        {submitting ? 'Recording...' : 'Record Sale'}
      </button>

      <Modal open={showNewCustomer} onClose={() => setShowNewCustomer(false)} title="New Customer">
        <form onSubmit={handleCreateCustomer} className="space-y-4">
          <p className="text-sm text-gray-500">Starts with no credit limit — set one from the Customers page if this account needs to buy on credit.</p>
          <CustomerNameField value={newCustomerForm.name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })} onDuplicateChange={setNewCustomerNameDuplicate} autoFocus />
          <Field label="Phone"><input type="text" value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} className={inputCls} /></Field>
          <FormButtons onCancel={() => setShowNewCustomer(false)} submitting={creatingCustomer} submitLabel="Add Customer" />
        </form>
      </Modal>

      {showTransportWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-3 text-amber-600">Transport price not entered</h2>
            <p className="text-sm text-gray-600 mb-4">You said we're handling transport but haven't entered a price. That's fine if it's complimentary, but we want to make sure it wasn't missed by mistake.</p>
            <div className="space-y-3">
              <button type="button" onClick={() => setShowTransportWarning(false)} className="w-full px-4 py-2 border rounded text-sm hover:bg-gray-50 font-medium">Go back &amp; add transport price</button>
              <button type="button" onClick={() => { setShowTransportWarning(false); submit(); }} disabled={submitting} className="w-full px-4 py-2 bg-amber-700 text-white rounded text-sm hover:bg-amber-800 font-medium disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Continue — Complimentary'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SalesHistoryTab({ branchId }) {
  const [orders, setOrders] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async (overrides = {}) => {
    const sd = overrides.from !== undefined ? overrides.from : from;
    const ed = overrides.to !== undefined ? overrides.to : to;
    const params = new URLSearchParams({ branchId, ...(sd ? { from: sd } : {}), ...(ed ? { to: ed } : {}) });
    const r = await fetch(`/api/admin/materials/shop/sales?${params}`);
    const d = await r.json();
    if (d.success) setOrders(d.data); else toast.error(d.error || 'Failed to load');
  }, [branchId, from, to]);

  useEffect(() => { load(); }, [load]);

  const clearDates = () => { setFrom(''); setTo(''); load({ from: '', to: '' }); };

  const handleVoid = async (order) => {
    const reason = prompt(`Delete sale ${order.orderNumber}? This permanently removes it and restores stock. Reason:`);
    if (!reason) return;
    const r = await fetch(`/api/admin/orders/${order.id}/void`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Sale deleted, stock restored'); load(); }
    else toast.error(d.error);
  };

  if (!orders) return <Loader />;

  return (
    <div>
      <Card className="p-4 mb-4">
        <div className="grid sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
          <div className="flex items-end gap-2">
            <button onClick={() => load()} className={`flex-1 ${btnPrimaryCls}`}>Filter</button>
            {(from || to) && <button onClick={clearDates} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">Clear</button>}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm min-w-[900px]">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Order #</th>
                <th className="px-4 py-3 text-left font-medium">Customer</th>
                <th className="px-4 py-3 text-left font-medium">Items</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-left font-medium">Payment</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.length === 0 && <EmptyRow colSpan={8} text="No shop sales yet" />}
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3">{formatDate(o.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{o.orderNumber}</td>
                  <td className="px-4 py-3">{o.customer ? <Link href={`/admin/customers/${o.customer.id}`} className="hover:underline">{o.customer.name}</Link> : 'Walk-in'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{o.lines.map((l) => <p key={l.id} className="whitespace-nowrap">{l.qty.toLocaleString()} {l.product.name}</p>)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(o.grandTotal / 100)}</td>
                  <td className="px-4 py-3 text-xs capitalize">{o.paymentMethod === 'credit' ? <span className="text-amber-700 font-medium">On Account</span> : o.paymentMethod}</td>
                  <td className="px-4 py-3"><StatusPill status={o.status} color={o.status === 'active' ? 'green' : 'red'} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/orders/${o.id}/receipt`} target="_blank" className={`${tableActionCls} mr-3`}>Receipt</Link>
                    {o.status === 'active' && <button onClick={() => handleVoid(o)} className={tableDangerActionCls}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ManageProductsTab({ serviceId, branchId }) {
  const [products, load] = useProducts(serviceId, branchId);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', unit: 'bag', price: '' });
  const [submitting, setSubmitting] = useState(false);
  const [priceFor, setPriceFor] = useState(null);
  const [newPrice, setNewPrice] = useState('');
  const [showStockIn, setShowStockIn] = useState(false);

  const openCreate = () => { setForm({ name: '', unit: 'bag', price: '' }); setShowModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, ...form, price: Math.round(Number(form.price || 0) * 100) }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowModal(false); load(); }
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
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: Math.round(Number(newPrice) * 100) }),
      });
      const d = await r.json();
      if (d.success) { toast.success(d.pricePending ? d.message : 'Price updated'); setPriceFor(null); setNewPrice(''); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!products) return <Loader />;

  return (
    <div>
      <div className="flex justify-end mb-4 gap-3">
        <button onClick={() => setShowStockIn(true)} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">Add Stock</button>
        <button onClick={openCreate} className={btnPrimaryCls}>Add Product</button>
      </div>
      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Unit</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Stock</th>
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
                  <td className="px-4 py-3 text-right">{p.currentPrice != null ? formatMoney(p.currentPrice / 100) : '—'}</td>
                  <td className="px-4 py-3 text-right">{(p.onHand || 0).toLocaleString()}</td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Shop Product">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name" required><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit"><input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls} placeholder="bag, piece, tonne..." /></Field>
            <Field label="Price"><NumberInput value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
          </div>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Product" />
        </form>
      </Modal>

      <Modal open={!!priceFor} onClose={() => setPriceFor(null)} title={`Edit Price — ${priceFor?.name || ''}`}>
        <form onSubmit={handlePriceChange} className="space-y-4">
          <p className="text-sm text-gray-500">If you're not an owner, this change won't take effect until an owner approves it.</p>
          <Field label="New price" required><NumberInput value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required autoFocus /></Field>
          <FormButtons onCancel={() => setPriceFor(null)} submitting={submitting} submitLabel="Save" />
        </form>
      </Modal>

      <StockInModal open={showStockIn} onClose={() => setShowStockIn(false)} products={products} branchId={branchId} onAdded={() => { setShowStockIn(false); load(); }} />
    </div>
  );
}
