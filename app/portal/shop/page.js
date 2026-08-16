'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, inputCls, btnPrimaryCls, NumberInput } from '@/components/ui';
import { formatMoney } from '@/lib/format';

export default function PortalShopPage() {
  const [data, setData] = useState(null);
  const [branchId, setBranchId] = useState('');
  const [cart, setCart] = useState([]); // [{ productId, name, unit, unitPrice, qty }]
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/portal/shop').then((r) => r.json()).then((d) => {
      if (d.success) {
        setData(d.data);
        if (d.data.branches.length === 1) setBranchId(d.data.branches[0].id);
      } else toast.error(d.error || 'Failed to load');
    });
  }, []);

  const addToCart = (product) => {
    setCart((c) => {
      const existing = c.find((l) => l.productId === product.id);
      if (existing) return c.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { productId: product.id, name: product.name, unit: product.unit, unitPrice: product.currentPrice, qty: 1 }];
    });
  };

  const updateQty = (productId, qty) => setCart((c) => c.map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, qty) } : l)));
  const removeLine = (productId) => setCart((c) => c.filter((l) => l.productId !== productId));
  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  const submitOrder = async (e) => {
    e.preventDefault();
    if (!branchId) return toast.error('Pick a branch');
    if (cart.length === 0) return toast.error('Add at least one product');
    setSubmitting(true);
    try {
      const r = await fetch('/api/portal/shop/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, lines: cart.map((l) => ({ productId: l.productId, qty: l.qty })) }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(`Order ${d.data.orderNumber} placed — we'll confirm it shortly`);
        setCart([]);
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) return <Loader />;

  return (
    <div>
      <PageHeader title="Shop" subtitle="Place an order — we'll confirm it before it's charged to your account" />

      {data.branches.length > 1 && (
        <div className="mb-4">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls + ' max-w-xs'}>
            <option value="">Choose a branch...</option>
            {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {data.products.length === 0 ? (
            <Card><EmptyState title="No products available yet" subtitle="Check back soon." /></Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {data.products.map((p) => (
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
          <h3 className="font-semibold text-sm mb-3">Your Order</h3>
          <div className="divide-y mb-3 max-h-64 overflow-y-auto">
            {cart.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No items yet — tap a product to add it.</p>}
            {cart.map((l) => (
              <div key={l.productId} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{l.name}</p>
                  <p className="text-xs text-gray-500">{formatMoney(l.unitPrice / 100)} / {l.unit}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <NumberInput
                    value={l.qty}
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
          <button onClick={submitOrder} disabled={submitting || cart.length === 0} className={`w-full ${btnPrimaryCls}`}>
            {submitting ? 'Placing order...' : 'Place Order'}
          </button>
        </Card>
      </div>
    </div>
  );
}
