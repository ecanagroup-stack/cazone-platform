'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, Modal, FormButtons, Field, inputCls, btnPrimaryCls, StatusPill } from '@/components/ui';

export default function ShiftPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';

  const [data, setData] = useState(null);
  const [selected, setSelected] = useState({}); // { [dispenserId]: { attendantId, opening } }
  const [prices, setPrices] = useState({}); // { [productId]: price in Naira, display units }
  const [openingFloat, setOpeningFloat] = useState(''); // Naira, display units
  const [beginning, setBeginning] = useState(false);

  const [closingFor, setClosingFor] = useState(null); // dispenserId
  const [closingForm, setClosingForm] = useState({ closing: '', rtt: '0' });
  const [submitting, setSubmitting] = useState(false);

  const [creditFillFor, setCreditFillFor] = useState(null); // dispenserId
  const [creditLitres, setCreditLitres] = useState('');
  const [creditCustomerQuery, setCreditCustomerQuery] = useState('');
  const [creditCustomerResults, setCreditCustomerResults] = useState([]);
  const [creditCustomer, setCreditCustomer] = useState(null);
  const [creditWarning, setCreditWarning] = useState(null); // { shortfall, error }
  const [overridePin, setOverridePin] = useState('');

  const [showEndModal, setShowEndModal] = useState(false);
  const [endForm, setEndForm] = useState({ countedCash: '', countedFloat: '', note: '' });

  const load = useCallback(async () => {
    if (!branchId) { setData(null); return; }
    const r = await fetch(`/api/admin/fuel/shift?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) {
      setData(d.data);
      if (!d.data.shift) {
        const priceDefaults = {};
        for (const [productId, kobo] of Object.entries(d.data.priceByProduct || {})) priceDefaults[productId] = (kobo / 100).toString();
        setPrices(priceDefaults);
      }
    } else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const toggleDispenser = (dispenserId) => {
    setSelected((s) => {
      const next = { ...s };
      if (next[dispenserId]) delete next[dispenserId];
      else next[dispenserId] = { attendantId: '', opening: '' };
      return next;
    });
  };

  const handleBeginShift = async (e) => {
    e.preventDefault();
    const assignments = Object.entries(selected).map(([dispenserId, v]) => ({ dispenserId, attendantId: v.attendantId, opening: v.opening }));
    if (assignments.length === 0) return toast.error('Select at least one dispenser to open');
    if (assignments.some((a) => !a.attendantId || a.opening === '')) return toast.error('Every selected dispenser needs an attendant and an opening reading');

    setBeginning(true);
    try {
      const priceEntries = Object.entries(prices).map(([productId, naira]) => ({ productId, price: Math.round(Number(naira) * 100) }));
      const r = await fetch('/api/admin/fuel/shift/begin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, openingFloat: Math.round(Number(openingFloat || 0) * 100), assignments, prices: priceEntries }),
      });
      const d = await r.json();
      if (d.success) { toast.success(d.message || 'Shift started'); setSelected({}); setOpeningFloat(''); load(); }
      else toast.error(d.error);
    } finally {
      setBeginning(false);
    }
  };

  const handleCloseDispenser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/dispensers/${closingFor}/close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(closingForm),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${d.data.litres.toLocaleString()} L recorded`); setClosingFor(null); setClosingForm({ closing: '', rtt: '0' }); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (creditCustomerQuery.trim().length < 2) { setCreditCustomerResults([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(creditCustomerQuery)}`);
      const d = await r.json();
      if (d.success) setCreditCustomerResults(d.data);
    }, 250);
    return () => clearTimeout(t);
  }, [creditCustomerQuery]);

  const closeCreditFillModal = () => {
    setCreditFillFor(null); setCreditLitres(''); setCreditCustomer(null);
    setCreditCustomerQuery(''); setCreditCustomerResults([]); setCreditWarning(null); setOverridePin('');
  };

  const submitCreditFill = async (overrideCredit = false, pin = '') => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/dispensers/${creditFillFor}/credit-fill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: creditCustomer.id, litres: Number(creditLitres), overrideCredit, pin }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.data.flagged ? `${d.data.litres.toLocaleString()} L recorded — flagged for credit override` : `${d.data.litres.toLocaleString()} L recorded to ${creditCustomer.name}`);
        closeCreditFillModal(); load();
      } else if (d.needsApproval) {
        setCreditWarning(d);
      } else {
        toast.error(d.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreditFill = (e) => {
    e.preventDefault();
    if (!creditCustomer) return toast.error('Pick a customer for this credit fill');
    setCreditWarning(null);
    submitCreditFill(false);
  };

  const handleEndShift = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/end`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countedCash: Math.round(Number(endForm.countedCash || 0) * 100),
          countedFloat: endForm.countedFloat === '' ? null : Math.round(Number(endForm.countedFloat) * 100),
          note: endForm.note,
        }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.data.flagged ? 'Shift closed — flagged for the difference' : 'Shift closed, cash balanced');
        setShowEndModal(false); setEndForm({ countedCash: '', countedFloat: '', note: '' }); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Pumps" subtitle="Run today's shift" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to run its shift." /></Card>
      </div>
    );
  }

  if (!data) return <Loader />;

  // --- Shift open: pump grid ---
  if (data.shift) {
    const allClosed = data.pumps.every((p) => p.reading?.closing != null);
    return (
      <div>
        <PageHeader
          title="Pumps"
          subtitle={`Shift open since ${new Date(data.shift.openedAt).toLocaleTimeString()}`}
          action={allClosed && <button onClick={() => setShowEndModal(true)} className={btnPrimaryCls}>End Shift</button>}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.pumps.map((p) => {
            const closed = p.reading?.closing != null;
            const litres = closed ? p.reading.closing - p.reading.opening - p.reading.rtt : null;
            return (
              <Card key={p.dispenserId} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm">{p.dispenserLabel}</p>
                  <StatusPill status={closed ? 'Closed' : 'Running'} color={closed ? 'gray' : 'green'} />
                </div>
                <p className="text-xs text-gray-500">{p.productName} — {p.attendantName}</p>
                <p className="text-xs text-gray-500 mt-1">Opening: {p.reading?.opening?.toLocaleString()}</p>
                {p.reading?.creditLitres > 0 && (
                  <p className="text-xs text-gray-500">Credit fills so far: {p.reading.creditLitres.toLocaleString()} L</p>
                )}
                {closed ? (
                  <p className="text-sm font-medium mt-2">{litres.toLocaleString()} L sold</p>
                ) : (
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={() => { setClosingFor(p.dispenserId); setClosingForm({ closing: '', rtt: '0' }); }}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      Record closing reading
                    </button>
                    <button
                      onClick={() => setCreditFillFor(p.dispenserId)}
                      className="text-sm font-medium text-gray-600 hover:text-gray-900"
                    >
                      Credit fill
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {!allClosed && <p className="text-xs text-gray-500 mt-4">End Shift unlocks once every pump has a closing reading.</p>}

        <Modal open={!!closingFor} onClose={() => setClosingFor(null)} title="Record Closing Reading">
          <form onSubmit={handleCloseDispenser} className="space-y-4">
            <Field label="Closing reading" required>
              <input type="number" step="0.01" value={closingForm.closing} onChange={(e) => setClosingForm({ ...closingForm, closing: e.target.value })} className={inputCls} required autoFocus />
            </Field>
            <Field label="Return to tank (RTT)">
              <input type="number" step="0.01" value={closingForm.rtt} onChange={(e) => setClosingForm({ ...closingForm, rtt: e.target.value })} className={inputCls} />
            </Field>
            <FormButtons onCancel={() => setClosingFor(null)} submitting={submitting} submitLabel="Save Reading" />
          </form>
        </Modal>

        <Modal open={!!creditFillFor} onClose={closeCreditFillModal} title="Credit Fill">
          <form onSubmit={handleCreditFill} className="space-y-4">
            <p className="text-sm text-gray-500">Records litres sold to a credit customer now — excluded from this pump's cash total at shift end.</p>
            <Field label="Customer" required>
              {creditCustomer ? (
                <div className="flex items-center justify-between bg-brand-50 rounded px-3 py-2 text-sm">
                  <span>{creditCustomer.name}{creditCustomer.phone ? ` — ${creditCustomer.phone}` : ''}</span>
                  <button type="button" onClick={() => setCreditCustomer(null)} className="text-xs text-gray-500 hover:text-gray-700">Remove</button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text" value={creditCustomerQuery} onChange={(e) => setCreditCustomerQuery(e.target.value)}
                    placeholder="Search customer" className={inputCls} autoFocus
                  />
                  {creditCustomerResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {creditCustomerResults.map((c) => (
                        <button
                          type="button" key={c.id}
                          onClick={() => { setCreditCustomer(c); setCreditCustomerQuery(''); setCreditCustomerResults([]); }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          {c.name}{c.phone ? ` — ${c.phone}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Field>
            <Field label="Litres" required>
              <input type="number" step="0.01" min="0.01" value={creditLitres} onChange={(e) => setCreditLitres(e.target.value)} className={inputCls} required />
            </Field>

            {creditWarning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                <p className="font-medium mb-1">Credit limit exceeded</p>
                <p className="mb-2">{creditWarning.error}</p>
                <input
                  type="password" inputMode="numeric" placeholder="Action PIN" value={overridePin}
                  onChange={(e) => setOverridePin(e.target.value)}
                  className="w-full mb-2 px-2 py-1 border rounded text-xs"
                />
                <button type="button" onClick={() => submitCreditFill(true, overridePin)} disabled={submitting || !overridePin} className="text-xs font-medium text-amber-900 underline disabled:opacity-50">
                  Proceed anyway (this will be flagged for the owner)
                </button>
              </div>
            )}

            <FormButtons onCancel={closeCreditFillModal} submitting={submitting} submitLabel="Record Credit Fill" />
          </form>
        </Modal>

        <Modal open={showEndModal} onClose={() => setShowEndModal(false)} title="End Shift — Cash Up">
          <form onSubmit={handleEndShift} className="space-y-4">
            <p className="text-sm text-gray-500">Count the cash on hand and enter it below — the expected amount and any difference are computed automatically.</p>
            <Field label="Counted cash" required>
              <input type="number" step="0.01" value={endForm.countedCash} onChange={(e) => setEndForm({ ...endForm, countedCash: e.target.value })} className={inputCls} required autoFocus />
            </Field>
            <Field label="Counted float">
              <input type="number" step="0.01" value={endForm.countedFloat} onChange={(e) => setEndForm({ ...endForm, countedFloat: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Note (required if the difference is large)">
              <textarea value={endForm.note} onChange={(e) => setEndForm({ ...endForm, note: e.target.value })} className={inputCls} rows={2} />
            </Field>
            <FormButtons onCancel={() => setShowEndModal(false)} submitting={submitting} submitLabel="Close Shift" />
          </form>
        </Modal>
      </div>
    );
  }

  // --- No shift open: Begin Shift form ---
  const productIds = [...new Set(data.dispensers.map((d) => d.tank?.productId).filter(Boolean))];

  return (
    <div>
      <PageHeader title="Pumps" subtitle="No shift is open — begin one to start recording sales" />

      {data.dispensers.length === 0 ? (
        <Card><EmptyState title="No dispensers set up yet" subtitle="Add a tank and dispenser from Manage → Tanks & Dispensers first." /></Card>
      ) : (
        <form onSubmit={handleBeginShift} className="space-y-6">
          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-4">Cash Float</h3>
            <Field label="Opening float" required>
              <input type="number" step="0.01" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} className={inputCls} required placeholder="Cash placed in the till at the start of the shift" />
            </Field>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-4">Prices</h3>
            <div className="grid grid-cols-2 gap-3">
              {productIds.map((productId) => {
                const product = data.products.find((p) => p.id === productId);
                return (
                  <Field key={productId} label={`${product?.name || productId} price per litre`}>
                    <input
                      type="number" step="0.01" value={prices[productId] ?? ''}
                      onChange={(e) => setPrices({ ...prices, [productId]: e.target.value })}
                      className={inputCls} required
                    />
                  </Field>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Assign Pumps</h3></div>
            <div className="divide-y">
              {data.dispensers.map((d) => {
                const on = !!selected[d.id];
                return (
                  <div key={d.id} className="px-4 py-3">
                    <label className="flex items-center gap-2 text-sm font-medium mb-2">
                      <input type="checkbox" checked={on} onChange={() => toggleDispenser(d.id)} />
                      {d.label} <span className="text-xs text-gray-400 font-normal">— {d.tank?.product?.name || 'no product'}</span>
                    </label>
                    {on && (
                      <div className="grid grid-cols-2 gap-3 pl-6">
                        <Field label="Attendant" required>
                          <select
                            value={selected[d.id].attendantId}
                            onChange={(e) => setSelected({ ...selected, [d.id]: { ...selected[d.id], attendantId: e.target.value } })}
                            className={inputCls} required
                          >
                            <option value="">Select...</option>
                            {data.attendants.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Opening reading" required>
                          <input
                            type="number" step="0.01" value={selected[d.id].opening}
                            onChange={(e) => setSelected({ ...selected, [d.id]: { ...selected[d.id], opening: e.target.value } })}
                            className={inputCls} required
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <button type="submit" disabled={beginning} className={btnPrimaryCls}>
            {beginning ? 'Starting...' : 'Begin Shift'}
          </button>
        </form>
      )}
    </div>
  );
}
