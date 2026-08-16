'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, Card, EmptyState, PageHeader, Modal, FormButtons, Field, inputCls, btnPrimaryCls, OtpField } from '@/components/ui';
import { formatMoney } from '@/lib/format';

export default function CounterPage() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';

  const [products, setProducts] = useState(null);
  const [allocations, setAllocations] = useState([]); // sellable Delivery rows, this branch
  const [cart, setCart] = useState([]); // [{ productId, name, unitPrice, qty, allocationId }]

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customer, setCustomer] = useState(null);

  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [submitting, setSubmitting] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null); // { shortfall, error }
  const [overridePin, setOverridePin] = useState('');

  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '' });
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const loadProducts = useCallback(async () => {
    if (!serviceId) { setProducts(null); return; }
    const r = await fetch(`/api/admin/materials/products?serviceId=${serviceId}`);
    const d = await r.json();
    if (d.success) setProducts(d.data.filter((p) => p.isActive && p.currentPrice != null));
    else toast.error(d.error || 'Failed to load products');
  }, [serviceId]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    if (!branchId) { setAllocations([]); return; }
    fetch(`/api/admin/materials/allocations?branchId=${branchId}`).then((r) => r.json()).then((d) => {
      if (d.success) setAllocations(d.data);
    });
  }, [branchId]);

  useEffect(() => {
    if (customerQuery.trim().length < 2) { setCustomerResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(customerQuery)}`);
      const d = await r.json();
      if (d.success) setCustomerResults(d.data);
    }, 250);
    return () => clearTimeout(t);
  }, [customerQuery]);

  const addToCart = (product) => {
    setCart((c) => {
      const existing = c.find((l) => l.productId === product.id);
      if (existing) return c.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { productId: product.id, name: product.name, unit: product.unit, unitPrice: product.currentPrice, qty: 1, allocationId: null }];
    });
  };

  const updateQty = (productId, qty) => {
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, qty) } : l)));
  };

  const updateAllocation = (productId, allocationId) => {
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, allocationId: allocationId || null } : l)));
  };

  const removeLine = (productId) => setCart((c) => c.filter((l) => l.productId !== productId));

  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    setCreatingCustomer(true);
    try {
      const r = await fetch('/api/admin/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCustomerForm),
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

  const submitOrder = async (overrideCredit = false, otp = '') => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, customerId: customer?.id || null, paymentMethod,
          lines: cart.map((l) => ({ productId: l.productId, qty: l.qty, allocationId: l.allocationId || undefined })),
          overrideCredit, otp,
        }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.data.flagged ? `Sale ${d.data.order.orderNumber} recorded — flagged for credit override` : `Sale ${d.data.order.orderNumber} recorded`);
        setCart([]); setCustomer(null); setCustomerQuery(''); setPaymentMethod('cash'); setCreditWarning(null); setOverridePin('');
      } else if (d.needsApproval) {
        setCreditWarning(d);
      } else {
        toast.error(d.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckout = (e) => {
    e.preventDefault();
    if (cart.length === 0) return toast.error('Add at least one product');
    setCreditWarning(null);
    submitOrder(false);
  };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Counter" subtitle="Ring up a sale" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to use the counter." /></Card>
      </div>
    );
  }

  if (!products) return <Loader />;

  return (
    <div>
      <PageHeader title="Counter" subtitle="Ring up a sale" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {products.length === 0 ? (
            <Card><EmptyState title="No priced products yet" subtitle="Add products with a price from Manage → Products." /></Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="text-left p-4 border rounded-lg bg-white hover:border-brand-500 hover:bg-brand-50"
                >
                  <p className="font-medium text-sm">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.unit}</p>
                  <p className="text-sm font-semibold mt-2">{formatMoney(p.currentPrice / 100)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <Card className="p-4 h-fit sticky top-4">
          <h3 className="font-semibold text-sm mb-3">Sale</h3>

          <div className="mb-3">
            {customer ? (
              <div className="flex items-center justify-between bg-brand-50 rounded px-3 py-2 text-sm">
                <span>{customer.name}{customer.phone ? ` — ${customer.phone}` : ''}</span>
                <button onClick={() => { setCustomer(null); setPaymentMethod('cash'); }} className="text-xs text-gray-500 hover:text-gray-700">Remove</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Search customer, or leave blank for walk-in" className={inputCls}
                />
                {(customerResults.length > 0 || customerQuery.trim().length >= 2) && (
                  <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {customerResults.map((c) => (
                      <button
                        key={c.id} onClick={() => { setCustomer(c); setCustomerQuery(''); setCustomerResults([]); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {c.name}{c.phone ? ` — ${c.phone}` : ''}
                      </button>
                    ))}
                    {customerQuery.trim().length >= 2 && (
                      <button
                        onClick={() => { setNewCustomerForm({ name: customerQuery, phone: '' }); setShowNewCustomer(true); }}
                        className="block w-full text-left px-3 py-2 text-sm text-brand-600 hover:bg-brand-50 border-t"
                      >
                        + New customer "{customerQuery}"
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="divide-y mb-3 max-h-64 overflow-y-auto">
            {cart.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No items yet — tap a product to add it.</p>}
            {cart.map((l) => {
              const productAllocations = allocations.filter((a) => a.productId === l.productId);
              return (
                <div key={l.productId} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-xs text-gray-500">{formatMoney(l.unitPrice / 100)} / {l.unit}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number" min="1" value={l.qty}
                        onChange={(e) => updateQty(l.productId, Number(e.target.value) || 1)}
                        className="w-14 px-1 py-1 border rounded text-sm text-center"
                      />
                      <button onClick={() => removeLine(l.productId)} className="text-xs text-red-600 hover:text-red-700">✕</button>
                    </div>
                  </div>
                  {productAllocations.length > 0 && (
                    <select
                      value={l.allocationId || ''}
                      onChange={(e) => updateAllocation(l.productId, e.target.value)}
                      className="w-full mt-1 text-xs border rounded px-2 py-1 bg-gray-50"
                    >
                      <option value="">On-hand stock</option>
                      {productAllocations.map((a) => (
                        <option key={a.id} value={a.id}>From {a.supplier?.name || 'allocation'} ({a.qtyRemaining.toLocaleString()} left)</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-between text-sm font-semibold mb-3 pt-2 border-t">
            <span>Total</span>
            <span>{formatMoney(total / 100)}</span>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">Payment method</label>
            <select value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); setCreditWarning(null); }} className={inputCls}>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="pos">POS</option>
              <option value="credit" disabled={!customer}>Credit (needs a customer)</option>
            </select>
          </div>

          {creditWarning && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              <p className="font-medium mb-1">Credit limit exceeded</p>
              <p className="mb-2">{creditWarning.error}</p>
              <div className="mb-2">
                <OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} />
              </div>
              <button
                onClick={() => submitOrder(true, overridePin)}
                disabled={submitting || !overridePin}
                className="text-xs font-medium text-amber-900 underline disabled:opacity-50"
              >
                Proceed anyway (this will be flagged for the owner)
              </button>
            </div>
          )}

          <button onClick={handleCheckout} disabled={submitting || cart.length === 0} className={`w-full ${btnPrimaryCls}`}>
            {submitting ? 'Recording...' : 'Complete Sale'}
          </button>
        </Card>
      </div>

      <Modal open={showNewCustomer} onClose={() => setShowNewCustomer(false)} title="New Customer">
        <form onSubmit={handleCreateCustomer} className="space-y-4">
          <p className="text-sm text-gray-500">Starts with no credit limit — set one from the Customers page if this account needs to buy on credit.</p>
          <Field label="Name" required>
            <input type="text" value={newCustomerForm.name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <Field label="Phone">
            <input type="text" value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} className={inputCls} />
          </Field>
          <FormButtons onCancel={() => setShowNewCustomer(false)} submitting={creatingCustomer} submitLabel="Add Customer" />
        </form>
      </Modal>
    </div>
  );
}
