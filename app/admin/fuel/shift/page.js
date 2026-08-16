'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, Modal, FormButtons, Field, inputCls, btnPrimaryCls, StatusPill, OtpField, NumberInput } from '@/components/ui';

export default function ShiftPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';
  const { data: authSession } = useSession();
  const role = authSession?.user?.role;
  const canSubmit = ['supervisor', 'manager', 'owner'].includes(role);
  const canRecordPayment = ['cashier', 'manager', 'owner'].includes(role);
  const canApprove = ['manager', 'owner'].includes(role);

  const [data, setData] = useState(null);
  const [selected, setSelected] = useState({}); // { [dispenserId]: { attendantId, opening } }
  const [prices, setPrices] = useState({}); // { [productId]: price in Naira, display units }
  const [openingFloat, setOpeningFloat] = useState(''); // Naira, display units
  const [totalShiftsPlanned, setTotalShiftsPlanned] = useState(''); // optional multi-shift-per-day
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

  const [dipFor, setDipFor] = useState(null); // tank object
  const [dipMeasured, setDipMeasured] = useState('');
  const [dipSubmitting, setDipSubmitting] = useState(false);

  const [reassignFor, setReassignFor] = useState(null); // dispenserId
  const [reassignForm, setReassignForm] = useState({ attendantId: '', reason: '' });
  const [showReassignLog, setShowReassignLog] = useState(false);
  const [reassignLog, setReassignLog] = useState(null);

  const [paymentFor, setPaymentFor] = useState(null); // dispenserId
  const [paymentForm, setPaymentForm] = useState({ cashCollected: '', posEntries: [] }); // posEntries: [{terminalId, amount}]

  const [approveFor, setApproveFor] = useState(null); // dispenserId
  const [approveNote, setApproveNote] = useState('');

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

    const zeroStockDispensers = data.dispensers.filter((d) => selected[d.id] && d.tank && (data.onHandByProduct?.[d.tank.productId] || 0) <= 0);
    if (zeroStockDispensers.length > 0) {
      const names = zeroStockDispensers.map((d) => d.label).join(', ');
      if (!confirm(`${names} currently ${zeroStockDispensers.length === 1 ? 'has' : 'have'} 0 L in stock. Begin the shift anyway?`)) return;
    }

    setBeginning(true);
    try {
      const priceEntries = Object.entries(prices).map(([productId, naira]) => ({ productId, price: Math.round(Number(naira) * 100) }));
      const r = await fetch('/api/admin/fuel/shift/begin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId, openingFloat: Math.round(Number(openingFloat || 0) * 100), assignments, prices: priceEntries,
          totalShiftsPlanned: totalShiftsPlanned || undefined,
        }),
      });
      const d = await r.json();
      if (d.success) { toast.success(d.message || 'Shift started'); setSelected({}); setOpeningFloat(''); setTotalShiftsPlanned(''); load(); }
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
      const r = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(creditCustomerQuery)}&branchId=${branchId}`);
      const d = await r.json();
      if (d.success) setCreditCustomerResults(d.data);
    }, 250);
    return () => clearTimeout(t);
  }, [creditCustomerQuery]);

  const closeCreditFillModal = () => {
    setCreditFillFor(null); setCreditLitres(''); setCreditCustomer(null);
    setCreditCustomerQuery(''); setCreditCustomerResults([]); setCreditWarning(null); setOverridePin('');
  };

  const submitCreditFill = async (overrideCredit = false, otp = '') => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/dispensers/${creditFillFor}/credit-fill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: creditCustomer.id, litres: Number(creditLitres), overrideCredit, otp }),
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

  const handleReassign = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/dispensers/${reassignFor}/reassign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reassignForm),
      });
      const d = await r.json();
      if (d.success) {
        toast.success('Pump reassigned');
        setReassignFor(null); setReassignForm({ attendantId: '', reason: '' }); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const openReassignLog = async () => {
    setShowReassignLog(true);
    const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/reassignments`);
    const d = await r.json();
    if (d.success) setReassignLog(d.data);
    else toast.error(d.error);
  };

  const openPaymentModal = (p) => {
    setPaymentFor(p.dispenserId);
    setPaymentForm({
      cashCollected: p.reading?.cashCollected != null ? (p.reading.cashCollected / 100).toString() : '',
      posEntries: (p.reading?.posPayments || []).map((pp) => ({ terminalId: pp.terminalId, amount: (pp.amount / 100).toString() })),
    });
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/dispensers/${paymentFor}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cashCollected: Math.round(Number(paymentForm.cashCollected || 0) * 100),
          posEntries: paymentForm.posEntries.filter((p) => p.terminalId && p.amount !== '').map((p) => ({ terminalId: p.terminalId, amount: Math.round(Number(p.amount) * 100) })),
        }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Payment recorded'); setPaymentFor(null); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const submitDip = async (e) => {
    e.preventDefault();
    setDipSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/tanks/${dipFor.id}/reconcile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ measured: Number(dipMeasured) }),
      });
      const d = await r.json();
      if (d.success) {
        toast[d.data.status === 'exception' ? 'error' : 'success'](
          d.data.status === 'exception' ? `Variance of ${d.data.variance.toFixed(1)}L flagged for review` : 'Closing stock recorded'
        );
        setDipFor(null); setDipMeasured(''); load();
      } else toast.error(d.error);
    } finally {
      setDipSubmitting(false);
    }
  };

  const handleApprove = async (decision) => {
    if (decision === 'query' && !approveNote.trim()) return toast.error('A note is required when querying a submission');
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${data.shift.id}/dispensers/${approveFor}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note: approveNote }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(decision === 'approve' ? 'Reading approved' : 'Sent back with a note');
        setApproveFor(null); setApproveNote(''); load();
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
    const allApproved = data.pumps.every((p) => p.reading?.reviewStatus === 'approved');
    const tanks = data.tanks || [];
    const allTanksDipped = tanks.every((t) => t.dippedThisShift);
    const canEndShift = allApproved && allTanksDipped;
    const approvingPump = data.pumps.find((p) => p.dispenserId === approveFor);

    // Day Summary (ecana's End Day summary) — sales by product from the same pump readings already
    // on screen, no separate report call needed.
    const salesByProduct = {};
    let totalExpected = 0;
    for (const p of data.pumps) {
      if (p.reading?.closing == null) continue;
      const litres = p.reading.litres ?? (p.reading.closing - p.reading.opening - p.reading.rtt);
      const key = p.productName || 'Unknown';
      const row = salesByProduct[key] || { litres: 0, amount: 0 };
      row.litres += litres;
      row.amount += p.reading.expectedAmount || 0;
      salesByProduct[key] = row;
      totalExpected += p.reading.expectedAmount || 0;
    }

    return (
      <div>
        <PageHeader
          title="Pumps"
          subtitle={`${data.shift.shiftLabel ? `${data.shift.shiftLabel} — ` : ''}Open since ${new Date(data.shift.openedAt).toLocaleTimeString()}${data.shift.totalShiftsPlanned ? ` (shift ${data.shift.shiftOrder} of ${data.shift.totalShiftsPlanned} today)` : ''}`}
          action={
            <div className="flex items-center gap-4">
              <button onClick={openReassignLog} className="text-sm font-medium text-gray-500 hover:text-gray-700">Reassignment Log</button>
              {allApproved && <button onClick={() => setShowEndModal(true)} disabled={!canEndShift} className={btnPrimaryCls}>End Shift</button>}
            </div>
          }
        />

        {allApproved && tanks.length > 0 && (
          <Card className="p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Day Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {Object.entries(salesByProduct).map(([name, s]) => (
                <div key={name} className="bg-gray-50 rounded p-3">
                  <p className="text-xs text-gray-500">{name}</p>
                  <p className="text-sm font-bold">{s.litres.toLocaleString()} L</p>
                  <p className="text-xs text-gray-600">₦{(s.amount / 100).toLocaleString()}</p>
                </div>
              ))}
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-500">Expected Revenue</p>
                <p className="text-sm font-bold">₦{(totalExpected / 100).toLocaleString()}</p>
              </div>
            </div>

            <h3 className="font-semibold text-sm mb-2">Closing Tank Stock</h3>
            <p className="text-xs text-gray-500 mb-3">Every tank needs a dip before this shift can end.</p>
            <div className="space-y-2">
              {tanks.map((t) => (
                <div key={t.id} className={`flex items-center justify-between rounded p-2 ${t.dippedThisShift ? 'bg-green-50' : 'bg-amber-50 border border-amber-200'}`}>
                  <p className="text-sm font-medium">{t.label} <span className="text-xs text-gray-500 font-normal">— {t.product?.name}</span></p>
                  {t.dippedThisShift ? (
                    <StatusPill status="Recorded" color="green" />
                  ) : (
                    <button onClick={() => { setDipFor(t); setDipMeasured(''); }} className="text-sm font-medium text-amber-700 hover:text-amber-900">Record Dip</button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.pumps.map((p) => {
            const submitted = p.reading?.closing != null;
            const status = p.reading?.reviewStatus || 'pending';
            const litres = submitted ? p.reading.litres ?? (p.reading.closing - p.reading.opening - p.reading.rtt) : null;
            const paid = p.reading?.paymentRecordedAt != null;
            const statusLabel = !submitted ? 'Running' : status === 'approved' ? 'Approved' : status === 'queried' ? 'Queried' : 'Pending Review';
            const statusColor = !submitted ? 'green' : status === 'approved' ? 'gray' : status === 'queried' ? 'amber' : 'blue';
            return (
              <Card key={p.dispenserId} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm">{p.dispenserLabel}</p>
                  <StatusPill status={statusLabel} color={statusColor} />
                </div>
                <p className="text-xs text-gray-500">{p.productName} — {p.attendantName}</p>
                <p className="text-xs text-gray-500 mt-1">Opening: {p.reading?.opening?.toLocaleString()}</p>
                {p.reading?.creditLitres > 0 && (
                  <p className="text-xs text-gray-500">Credit fills so far: {p.reading.creditLitres.toLocaleString()} L</p>
                )}
                {submitted && (
                  <p className="text-sm font-medium mt-2">
                    {litres.toLocaleString()} L — {(p.reading.expectedAmount / 100).toLocaleString(undefined, { style: 'currency', currency: 'NGN' })}
                  </p>
                )}
                {submitted && (
                  <p className="text-xs text-gray-500">
                    {paid ? `Payment recorded: ₦${(p.reading.cashCollected / 100).toLocaleString()} cash${p.reading.posPayments?.length ? ` + ${p.reading.posPayments.length} POS entr${p.reading.posPayments.length === 1 ? 'y' : 'ies'}` : ''}` : 'Payment not yet recorded'}
                  </p>
                )}
                {status === 'queried' && p.reading?.discrepancyNote && (
                  <p className="text-xs text-amber-700 mt-1">Manager's note: {p.reading.discrepancyNote}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 mt-3">
                  {(!submitted || status === 'queried') && canSubmit && (
                    <button
                      onClick={() => { setClosingFor(p.dispenserId); setClosingForm({ closing: '', rtt: '0' }); }}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      {status === 'queried' ? 'Resubmit reading' : 'Record closing reading'}
                    </button>
                  )}
                  {submitted && status !== 'approved' && canRecordPayment && (
                    <button onClick={() => openPaymentModal(p)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                      {paid ? 'Edit payment' : 'Record payment'}
                    </button>
                  )}
                  {submitted && status !== 'approved' && canApprove && (
                    <button onClick={() => { setApproveFor(p.dispenserId); setApproveNote(''); }} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                      Review
                    </button>
                  )}
                  {status === 'approved' && p.reading?.orderId && (
                    <Link href={`/admin/orders/${p.reading.orderId}/receipt`} target="_blank" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                      Receipt
                    </Link>
                  )}
                  {!submitted && (
                    <>
                      <button
                        onClick={() => setCreditFillFor(p.dispenserId)}
                        className="text-sm font-medium text-gray-600 hover:text-gray-900"
                      >
                        Credit fill
                      </button>
                      <button
                        onClick={() => { setReassignFor(p.dispenserId); setReassignForm({ attendantId: '', reason: '' }); }}
                        className="text-sm font-medium text-gray-600 hover:text-gray-900"
                      >
                        Reassign
                      </button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {!allApproved && <p className="text-xs text-gray-500 mt-4">End Shift unlocks once every pump's reading has been submitted, paid, and approved by a manager.</p>}

        <Modal open={!!closingFor} onClose={() => setClosingFor(null)} title="Record Closing Reading">
          <form onSubmit={handleCloseDispenser} className="space-y-4">
            <Field label="Closing reading" required>
              <NumberInput value={closingForm.closing} onChange={(e) => setClosingForm({ ...closingForm, closing: e.target.value })} required autoFocus />
            </Field>
            <Field label="Return to tank (RTT)">
              <NumberInput value={closingForm.rtt} onChange={(e) => setClosingForm({ ...closingForm, rtt: e.target.value })} />
            </Field>
            <FormButtons onCancel={() => setClosingFor(null)} submitting={submitting} submitLabel="Save Reading" />
          </form>
        </Modal>

        <Modal open={!!paymentFor} onClose={() => setPaymentFor(null)} title="Record Payment">
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <p className="text-sm text-gray-500">Cash collected plus any card/transfer entries against a registered POS terminal.</p>
            <Field label="Cash collected" required>
              <NumberInput value={paymentForm.cashCollected} onChange={(e) => setPaymentForm({ ...paymentForm, cashCollected: e.target.value })} required autoFocus />
            </Field>
            <Field label="POS entries">
              <div className="space-y-2">
                {paymentForm.posEntries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={entry.terminalId}
                      onChange={(e) => setPaymentForm({ ...paymentForm, posEntries: paymentForm.posEntries.map((p, idx) => idx === i ? { ...p, terminalId: e.target.value } : p) })}
                      className={inputCls}
                    >
                      <option value="">Select terminal...</option>
                      {(data.posTerminals || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <NumberInput
                      value={entry.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, posEntries: paymentForm.posEntries.map((p, idx) => idx === i ? { ...p, amount: e.target.value } : p) })}
                      placeholder="Amount"
                    />
                    <button type="button" onClick={() => setPaymentForm({ ...paymentForm, posEntries: paymentForm.posEntries.filter((_, idx) => idx !== i) })} className="text-xs text-red-600">Remove</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPaymentForm({ ...paymentForm, posEntries: [...paymentForm.posEntries, { terminalId: '', amount: '' }] })}
                  className="text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  + Add POS entry
                </button>
              </div>
            </Field>
            <FormButtons onCancel={() => setPaymentFor(null)} submitting={submitting} submitLabel="Save Payment" />
          </form>
        </Modal>

        <Modal open={!!approveFor} onClose={() => { setApproveFor(null); setApproveNote(''); }} title="Review Pump Reading">
          {approvingPump && (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><span className="text-gray-500">Litres sold:</span> {approvingPump.reading.litres?.toLocaleString()} L</p>
                <p><span className="text-gray-500">Expected amount:</span> ₦{(approvingPump.reading.expectedAmount / 100).toLocaleString()}</p>
                <p><span className="text-gray-500">Cash collected:</span> {approvingPump.reading.cashCollected != null ? `₦${(approvingPump.reading.cashCollected / 100).toLocaleString()}` : 'Not recorded'}</p>
                {(approvingPump.reading.posPayments || []).map((pp) => (
                  <p key={pp.id}><span className="text-gray-500">POS ({pp.terminal.label}):</span> ₦{(pp.amount / 100).toLocaleString()}</p>
                ))}
              </div>
              <Field label="Note (required if querying)">
                <textarea value={approveNote} onChange={(e) => setApproveNote(e.target.value)} className={inputCls} rows={2} placeholder="Explain the discrepancy for the supervisor/cashier" />
              </Field>
              <div className="flex items-center gap-3">
                <button type="button" disabled={submitting} onClick={() => handleApprove('approve')} className={btnPrimaryCls}>Approve</button>
                <button type="button" disabled={submitting} onClick={() => handleApprove('query')} className="text-sm font-medium text-amber-700 hover:text-amber-900">Send back with note</button>
                <button type="button" onClick={() => { setApproveFor(null); setApproveNote(''); }} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            </div>
          )}
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
              <NumberInput value={creditLitres} onChange={(e) => setCreditLitres(e.target.value)} required />
            </Field>

            {creditWarning && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                <p className="font-medium mb-1">Credit limit exceeded</p>
                <p className="mb-2">{creditWarning.error}</p>
                <div className="mb-2">
                  <OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} />
                </div>
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
              <NumberInput value={endForm.countedCash} onChange={(e) => setEndForm({ ...endForm, countedCash: e.target.value })} required autoFocus />
            </Field>
            <Field label="Counted float">
              <NumberInput value={endForm.countedFloat} onChange={(e) => setEndForm({ ...endForm, countedFloat: e.target.value })} />
            </Field>
            <Field label="Note (required if the difference is large)">
              <textarea value={endForm.note} onChange={(e) => setEndForm({ ...endForm, note: e.target.value })} className={inputCls} rows={2} />
            </Field>
            <FormButtons onCancel={() => setShowEndModal(false)} submitting={submitting} submitLabel="Close Shift" />
          </form>
        </Modal>

        <Modal open={!!reassignFor} onClose={() => setReassignFor(null)} title="Reassign Pump">
          <form onSubmit={handleReassign} className="space-y-4">
            <p className="text-sm text-gray-500">Ends the current attendant's assignment on this pump and hands it to someone else — kept as a permanent log, not an edit.</p>
            <Field label="New attendant" required>
              <select value={reassignForm.attendantId} onChange={(e) => setReassignForm({ ...reassignForm, attendantId: e.target.value })} className={inputCls} required autoFocus>
                <option value="">Select...</option>
                {(data.attendants || []).filter((a) => a.id !== data.pumps.find((p) => p.dispenserId === reassignFor)?.attendantId).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Reason" required>
              <textarea value={reassignForm.reason} onChange={(e) => setReassignForm({ ...reassignForm, reason: e.target.value })} className={inputCls} rows={2} required placeholder="Why is this pump changing hands?" />
            </Field>
            <FormButtons onCancel={() => setReassignFor(null)} submitting={submitting} submitLabel="Reassign" />
          </form>
        </Modal>

        <Modal open={!!dipFor} onClose={() => setDipFor(null)} title={`Record Dip — ${dipFor?.label || ''}`}>
          <form onSubmit={submitDip} className="space-y-4">
            <p className="text-sm text-gray-500">Enter the physical dip reading in litres for this tank's closing stock.</p>
            <Field label="Measured (litres)" required>
              <NumberInput value={dipMeasured} onChange={(e) => setDipMeasured(e.target.value)} required autoFocus />
            </Field>
            <FormButtons onCancel={() => setDipFor(null)} submitting={dipSubmitting} submitLabel="Record Dip" />
          </form>
        </Modal>

        <Modal open={showReassignLog} onClose={() => setShowReassignLog(false)} title="Reassignment Log">
          {!reassignLog ? (
            <Loader />
          ) : reassignLog.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">No reassignments this shift.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {reassignLog.map((r) => (
                <div key={r.id} className="border-b pb-3">
                  <p className="text-sm font-medium">{r.dispenser.label} — {r.attendant.name}</p>
                  <p className="text-xs text-gray-500">Ended {r.endedAt ? new Date(r.endedAt).toLocaleTimeString() : ''}</p>
                  <p className="text-sm text-gray-700 mt-1">{r.reassignReason}</p>
                </div>
              ))}
            </div>
          )}
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
              <NumberInput value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} required placeholder="Cash placed in the till at the start of the shift" />
            </Field>
            <div className="mt-4">
              <Field label="Shifts planned today (optional)">
                <NumberInput value={totalShiftsPlanned} onChange={(e) => setTotalShiftsPlanned(e.target.value)} placeholder="Leave blank to run shifts unlabeled" />
              </Field>
              <p className="text-xs text-gray-500 mt-1">Only needs setting on the first shift of the day — later shifts pick it up automatically and get numbered.</p>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-4">Prices</h3>
            <div className="grid grid-cols-2 gap-3">
              {productIds.map((productId) => {
                const product = data.products.find((p) => p.id === productId);
                return (
                  <Field key={productId} label={`${product?.name || productId} price per litre`}>
                    <NumberInput
                      value={prices[productId] ?? ''}
                      onChange={(e) => setPrices({ ...prices, [productId]: e.target.value })}
                      required
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
                const onHand = d.tank?.productId != null ? (data.onHandByProduct?.[d.tank.productId] || 0) : null;
                const zeroStock = d.tank && onHand <= 0;
                return (
                  <div key={d.id} className="px-4 py-3">
                    <label className="flex items-center gap-2 text-sm font-medium mb-2">
                      <input type="checkbox" checked={on} onChange={() => toggleDispenser(d.id)} />
                      {d.label} <span className="text-xs text-gray-400 font-normal">— {d.tank?.product?.name || 'no product'}</span>
                      {zeroStock && <StatusPill status="0 L in stock" color="amber" />}
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
                          <NumberInput
                            value={selected[d.id].opening}
                            onChange={(e) => setSelected({ ...selected, [d.id]: { ...selected[d.id], opening: e.target.value } })}
                            required
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
