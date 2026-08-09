'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, Card, EmptyState, PageHeader, inputCls, btnPrimaryCls } from '@/components/ui';
import { formatMoney } from '@/lib/format';

export default function CounterPage() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';

  const [products, setProducts] = useState(null);
  const [cart, setCart] = useState([]); // [{ productId, name, unitPrice, qty }]

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customer, setCustomer] = useState(null);

  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [submitting, setSubmitting] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null); // { shortfall, error }

  const loadProducts = useCallback(async () => {
    if (!serviceId) { setProducts(null); return; }
    const r = await fetch(`/api/admin/materials/products?serviceId=${serviceId}`);
    const d = await r.json();
    if (d.success) setProducts(d.data.filter((p) => p.isActive && p.currentPrice != null));
    else toast.error(d.error || 'Failed to load products');
  }, [serviceId]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    if (customerQuery.trim().length < 2) { setCustomerResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/materials/counter/customers?q=${encodeURIComponent(customerQuery)}`);
      const d = await r.json();
      if (d.success) setCustomerResults(d.data);
    }, 250);
    return () => clearTimeout(t);
  }, [customerQuery]);

  const addToCart = (product) => {
    setCart((c) => {
      const existing = c.find((l) => l.productId === product.id);
      if (existing) return c.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { productId: product.id, name: product.name, unit: product.unit, unitPrice: product.currentPrice, qty: 1 }];
    });
  };

  const updateQty = (productId, qty) => {
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, qty) } : l)));
  };

  const removeLine = (productId) => setCart((c) => c.filter((l) => l.productId !== productId));

  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  const submitOrder = async (overrideCredit = false) => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/materials/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, customerId: customer?.id || null, paymentMethod,
          lines: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
          overrideCredit,
        }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.data.flagged ? `Sale ${d.data.order.orderNumber} recorded — flagged for credit override` : `Sale ${d.data.order.orderNumber} recorded`);
        setCart([]); setCustomer(null); setCustomerQuery(''); setPaymentMethod('cash'); setCreditWarning(null);
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
                {customerResults.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {customerResults.map((c) => (
                      <button
                        key={c.id} onClick={() => { setCustomer(c); setCustomerQuery(''); setCustomerResults([]); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {c.name}{c.phone ? ` — ${c.phone}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="divide-y mb-3 max-h-64 overflow-y-auto">
            {cart.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No items yet — tap a product to add it.</p>}
            {cart.map((l) => (
              <div key={l.productId} className="py-2 flex items-center justify-between gap-2">
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
            ))}
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
              <p>{creditWarning.error}</p>
              <button
                onClick={() => submitOrder(true)}
                disabled={submitting}
                className="mt-2 text-xs font-medium text-amber-900 underline"
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
    </div>
  );
}
