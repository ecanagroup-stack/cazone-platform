'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, EmptyState, Field, Loader, PageHeader, btnPrimaryCls, inputCls } from '@/components/ui';
import { formatMoney } from '@/lib/format';

const METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'transfer', label: 'Transfer' }, { value: 'pos', label: 'POS' }];

// Staff sell an ATC to a customer who pays at the counter. Staff see the in-house serial, fuel, litres
// and price only; the real ATC number is never sent to this page. Prices come from the price list.
export default function SellAtcPage() {
  const [atcs, setAtcs] = useState(null);
  const [atcId, setAtcId] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [method, setMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [sold, setSold] = useState(null);

  const load = useCallback(async () => {
    const result = await fetch('/api/admin/distributor/atcs?scope=sellable').then((r) => r.json());
    if (result.success) setAtcs(result.data.atcs); else toast.error(result.error || 'Could not load ATCs');
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (customer || query.trim().length < 2) { setResults([]); return undefined; }
    const timer = setTimeout(async () => {
      const result = await fetch(`/api/admin/distributor/sell?q=${encodeURIComponent(query.trim())}`).then((r) => r.json());
      setResults(result.success ? result.data : []);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, customer]);

  if (!atcs) return <Loader />;
  const selected = atcs.find((a) => a.id === atcId);
  const total = selected?.currentTotalPrice;

  async function sell(event) {
    event.preventDefault();
    if (!selected || !customer) return;
    setSaving(true);
    try {
      const result = await fetch('/api/admin/distributor/sell', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atcId: selected.id, customerId: customer.id, paymentMethod: method }),
      }).then((r) => r.json());
      if (!result.success) {
        toast.error(result.error || 'Could not complete the sale');
        if (result.error?.includes('Someone else')) { setAtcId(''); load(); }
        return;
      }
      setSold({ serial: selected.serial, customer: customer.name, amount: result.data.totalPrice });
      setAtcId(''); setCustomer(null); setQuery(''); setMethod('cash'); load();
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Sell an ATC" subtitle="Record an ATC sold to a customer who has paid you" />
      {sold && (
        <Card className="mb-6 border-green-300 bg-green-50 p-4 text-sm text-green-800">
          {sold.serial} sold to {sold.customer} for {formatMoney(sold.amount / 100)}. The ATC manager has been told.
        </Card>
      )}
      {atcs.length === 0 ? (
        <Card><EmptyState title="No ATCs on sale" subtitle="The ATC manager records ATCs before they can be sold." /></Card>
      ) : (
        <Card className="p-5">
          <form onSubmit={sell} className="space-y-5">
            <Field label="ATC" required>
              <select required value={atcId} onChange={(e) => setAtcId(e.target.value)} className={inputCls}>
                <option value="">— Select ATC —</option>
                {atcs.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.currentTotalPrice == null}>
                    {a.serial} — {a.litres.toLocaleString('en-NG')} L {a.product.name}{a.currentTotalPrice == null ? ' (no price set)' : ` — ${formatMoney(a.currentTotalPrice / 100)}`}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Customer" required>
              {customer ? (
                <div className="flex items-center justify-between rounded border bg-gray-50 px-3 py-2 text-sm">
                  <span>{customer.name}{customer.businessName ? ` · ${customer.businessName}` : ''}{customer.phone ? ` · ${customer.phone}` : ''}</span>
                  <button type="button" onClick={() => { setCustomer(null); setQuery(''); }} className="text-xs font-medium text-brand-600">Change</button>
                </div>
              ) : (
                <div className="relative">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, business or phone" className={inputCls} />
                  {results.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border bg-white shadow">
                      {results.map((c) => (
                        <li key={c.id}>
                          <button type="button" onClick={() => setCustomer(c)} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                            {c.name}{c.businessName ? ` · ${c.businessName}` : ''}{c.phone ? ` · ${c.phone}` : ''}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Field>

            <Field label="Payment received" required>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>

            {selected && total != null && (
              <div className="flex items-center justify-between rounded bg-gray-50 px-4 py-3">
                <span className="text-sm text-gray-600">{selected.litres.toLocaleString('en-NG')} L at {formatMoney(selected.currentUnitPrice / 100)}/L</span>
                <span className="text-lg font-bold">{formatMoney(total / 100)}</span>
              </div>
            )}

            <button disabled={saving || !selected || !customer} className={`${btnPrimaryCls} w-full`}>{saving ? 'Saving...' : 'Record sale'}</button>
          </form>
        </Card>
      )}
    </div>
  );
}
