'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { PageHeader, Card, EmptyState, Field, FormButtons, inputCls, btnPrimaryCls, NumberInput, OtpField } from '@/components/ui';

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const STEPS = [
  { key: 'setup', label: 'Date & Branch' },
  { key: 'shift', label: 'Shift' },
  { key: 'readings', label: 'Pump Readings' },
  { key: 'deliveries', label: 'Deliveries' },
  { key: 'dips', label: 'Tank Dips' },
  { key: 'payments', label: 'Payments' },
  { key: 'deposits', label: 'Bank Deposits' },
];

// Ported from petrol-station-app's Backfill wizard — historical data entry for dates before an org
// subscribed to cazone. Owner-only, OTP-gated once (on the Shift step — see the backing route for
// why later steps don't re-verify), one call per step against /api/admin/fuel/backfill.
export default function BackfillPage() {
  const searchParams = useSearchParams();
  const branchIdFromUrl = searchParams.get('branch') || '';

  const [step, setStep] = useState('setup');
  const [date, setDate] = useState(yesterdayIso());
  const [branchId, setBranchId] = useState(branchIdFromUrl);
  const [reference, setReference] = useState(null); // dispensers, attendants, products, tanks
  const [shiftId, setShiftId] = useState('');

  const [otp, setOtp] = useState('');
  const [openingFloat, setOpeningFloat] = useState('');
  const [assignForm, setAssignForm] = useState({}); // dispenserId -> { attendantId, opening }
  const [submitting, setSubmitting] = useState(false);

  const [readingForm, setReadingForm] = useState({ dispenserId: '', closing: '', rtt: '0', price: '' });
  const [readingsDone, setReadingsDone] = useState([]);

  const [deliveryForm, setDeliveryForm] = useState({ productId: '', quantity: '', costPerUnit: '', supplierName: '' });
  const [deliveriesDone, setDeliveriesDone] = useState([]);

  const [dipForm, setDipForm] = useState({ productId: '', measured: '' });
  const [dipsDone, setDipsDone] = useState([]);

  const [paymentForm, setPaymentForm] = useState({ dispenserId: '', cashCollected: '' });
  const [paymentsDone, setPaymentsDone] = useState([]);

  const [depositForm, setDepositForm] = useState({ amount: '', bankName: '' });
  const [depositsDone, setDepositsDone] = useState([]);

  useEffect(() => {
    if (!branchId) { setReference(null); return; }
    fetch(`/api/admin/fuel/shift?branchId=${branchId}`).then((r) => r.json()).then((d) => {
      if (d.success) setReference({ dispensers: d.data.dispensers || [], attendants: d.data.attendants || [], products: d.data.products || [] });
    });
  }, [branchId]);

  const submitStep = async (body) => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, date }),
      });
      const d = await r.json();
      if (!d.success) { toast.error(d.error); return null; }
      return d.data;
    } finally {
      setSubmitting(false);
    }
  };

  const handleShift = async (e) => {
    e.preventDefault();
    const touched = Object.entries(assignForm).filter(([, v]) => v.attendantId || v.opening !== undefined && v.opening !== '');
    const incomplete = touched.find(([, v]) => !v.attendantId || v.opening === undefined || v.opening === '');
    if (incomplete) return toast.error('Every pump you started filling in needs both an attendant and an opening reading — finish it or clear both fields to skip it');
    const assignments = touched.map(([dispenserId, v]) => ({ dispenserId, attendantId: v.attendantId, opening: v.opening }));
    if (assignments.length === 0) return toast.error('Assign at least one pump — pick an attendant and enter an opening reading for at least one row above');
    const data = await submitStep({ type: 'shift', branchId, openingFloat: Number(openingFloat) || 0, assignments, otp });
    if (data) { toast.success('Shift added'); setShiftId(data.id); setStep('readings'); }
  };

  const handleReading = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'reading', shiftId, dispenserId: readingForm.dispenserId, closing: readingForm.closing, rtt: readingForm.rtt, price: Math.round(Number(readingForm.price) * 100) });
    if (data) { toast.success('Reading added'); setReadingsDone((r) => [...r, { ...readingForm }]); setReadingForm({ dispenserId: '', closing: '', rtt: '0', price: '' }); }
  };

  const handleDelivery = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'delivery', branchId, productId: deliveryForm.productId, quantity: deliveryForm.quantity, costPerUnit: Math.round(Number(deliveryForm.costPerUnit) * 100), supplierName: deliveryForm.supplierName });
    if (data) { toast.success('Delivery added'); setDeliveriesDone((d) => [...d, { ...deliveryForm }]); setDeliveryForm({ productId: '', quantity: '', costPerUnit: '', supplierName: '' }); }
  };

  const handleDip = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'dip', branchId, productId: dipForm.productId, measured: dipForm.measured });
    if (data) { toast.success('Dip added'); setDipsDone((d) => [...d, { ...dipForm }]); setDipForm({ productId: '', measured: '' }); }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'payment', shiftId, dispenserId: paymentForm.dispenserId, cashCollected: Math.round(Number(paymentForm.cashCollected) * 100) });
    if (data) { toast.success('Payment added'); setPaymentsDone((p) => [...p, { ...paymentForm }]); setPaymentForm({ dispenserId: '', cashCollected: '' }); }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'deposit', branchId, shiftId, amount: Math.round(Number(depositForm.amount) * 100), bankName: depositForm.bankName });
    if (data) { toast.success('Deposit added'); setDepositsDone((d) => [...d, { ...depositForm }]); setDepositForm({ amount: '', bankName: '' }); }
  };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Historical Backfill" subtitle="Enter data for a date before this branch went live on cazone" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a fuel branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Historical Backfill" subtitle="Owner only — for dates before this branch went live on cazone" />

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {STEPS.map((s) => (
          <span key={s.key} className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${step === s.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
            {s.label}
          </span>
        ))}
      </div>

      {step === 'setup' && (
        <Card className="p-5 max-w-md">
          <Field label="Date" required>
            <input type="date" value={date} max={yesterdayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <button onClick={() => setStep('shift')} className={`mt-4 ${btnPrimaryCls}`}>Continue</button>
        </Card>
      )}

      {step === 'shift' && reference && reference.dispensers.length === 0 && (
        <Card className="p-6 max-w-2xl text-center">
          <p className="text-sm font-medium text-gray-900 mb-1">No pumps set up at this branch yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Backfilling a historical shift needs at least one tank and dispenser to already exist —
            there's nothing to enter historical readings against otherwise. Set that up once
            (it only takes a minute), then come back here.
          </p>
          <Link href={`/admin/fuel/tanks?branch=${branchId}`} className={btnPrimaryCls}>Go to Fuel Setup</Link>
        </Card>
      )}

      {step === 'shift' && reference && reference.dispensers.length > 0 && (
        <Card className="p-5 max-w-2xl">
          <form onSubmit={handleShift} className="space-y-4">
            <Field label="Opening float">
              <NumberInput value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} placeholder="Cash that was in the till at the start of this historical shift" />
            </Field>
            <div>
              <p className="text-sm font-medium mb-2">Pump assignments</p>
              <p className="text-xs text-gray-500 mb-3">Every pump you enter needs both an attendant and an opening reading. Leave a pump's row completely untouched to skip it for this historical shift.</p>
              <div className="space-y-3">
                {reference.dispensers.map((d) => (
                  <div key={d.id} className="border rounded p-3">
                    <p className="text-sm font-medium mb-2">{d.label} <span className="text-xs text-gray-400">— {d.tank?.product?.name}</span></p>
                    <div className="grid grid-cols-2 gap-3">
                      <select value={assignForm[d.id]?.attendantId || ''} onChange={(e) => setAssignForm({ ...assignForm, [d.id]: { ...assignForm[d.id], attendantId: e.target.value } })} className={inputCls}>
                        <option value="">Select attendant...</option>
                        {reference.attendants.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <NumberInput value={assignForm[d.id]?.opening ?? ''} onChange={(e) => setAssignForm({ ...assignForm, [d.id]: { ...assignForm[d.id], opening: e.target.value } })} placeholder="Opening reading" />
                    </div>
                  </div>
                ))}
              </div>
              {reference.attendants.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                  No attendants registered yet — you can still assign a pump without one, or add attendants first from Fuel Setup.
                </p>
              )}
            </div>
            <Field label="Verification code" required>
              <OtpField purpose="backfill" value={otp} onChange={setOtp} />
            </Field>
            <button type="submit" disabled={submitting || !otp} className={`${btnPrimaryCls} disabled:opacity-50`}>{submitting ? 'Saving...' : 'Add Shift'}</button>
          </form>
        </Card>
      )}

      {step === 'readings' && reference && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm text-gray-500 mb-4">{readingsDone.length} reading(s) added.</p>
          <form onSubmit={handleReading} className="space-y-4">
            <Field label="Pump" required>
              <select value={readingForm.dispenserId} onChange={(e) => setReadingForm({ ...readingForm, dispenserId: e.target.value })} className={inputCls} required>
                <option value="">Select...</option>
                {reference.dispensers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Closing" required><NumberInput value={readingForm.closing} onChange={(e) => setReadingForm({ ...readingForm, closing: e.target.value })} required /></Field>
              <Field label="RTT"><NumberInput value={readingForm.rtt} onChange={(e) => setReadingForm({ ...readingForm, rtt: e.target.value })} /></Field>
              <Field label="Price/L then" required><NumberInput value={readingForm.price} onChange={(e) => setReadingForm({ ...readingForm, price: e.target.value })} required /></Field>
            </div>
            <FormButtons onCancel={() => setStep('deliveries')} submitting={submitting} submitLabel="Add Reading" />
          </form>
        </Card>
      )}

      {step === 'deliveries' && reference && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm text-gray-500 mb-4">{deliveriesDone.length} delivery(ies) added. Optional — skip if none.</p>
          <form onSubmit={handleDelivery} className="space-y-4">
            <Field label="Product" required>
              <select value={deliveryForm.productId} onChange={(e) => setDeliveryForm({ ...deliveryForm, productId: e.target.value })} className={inputCls} required>
                <option value="">Select...</option>
                {reference.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity" required><NumberInput value={deliveryForm.quantity} onChange={(e) => setDeliveryForm({ ...deliveryForm, quantity: e.target.value })} required /></Field>
              <Field label="Cost per litre" required><NumberInput value={deliveryForm.costPerUnit} onChange={(e) => setDeliveryForm({ ...deliveryForm, costPerUnit: e.target.value })} required /></Field>
            </div>
            <Field label="Supplier"><input type="text" value={deliveryForm.supplierName} onChange={(e) => setDeliveryForm({ ...deliveryForm, supplierName: e.target.value })} className={inputCls} /></Field>
            <FormButtons onCancel={() => setStep('dips')} submitting={submitting} submitLabel="Add Delivery" />
          </form>
        </Card>
      )}

      {step === 'dips' && reference && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm text-gray-500 mb-4">{dipsDone.length} dip(s) added. Optional — skip if none.</p>
          <form onSubmit={handleDip} className="space-y-4">
            <Field label="Product" required>
              <select value={dipForm.productId} onChange={(e) => setDipForm({ ...dipForm, productId: e.target.value })} className={inputCls} required>
                <option value="">Select...</option>
                {reference.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Measured (litres)" required><NumberInput value={dipForm.measured} onChange={(e) => setDipForm({ ...dipForm, measured: e.target.value })} required /></Field>
            <FormButtons onCancel={() => setStep('payments')} submitting={submitting} submitLabel="Add Dip" />
          </form>
        </Card>
      )}

      {step === 'payments' && reference && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm text-gray-500 mb-4">{paymentsDone.length} payment(s) added.</p>
          <form onSubmit={handlePayment} className="space-y-4">
            <Field label="Pump" required>
              <select value={paymentForm.dispenserId} onChange={(e) => setPaymentForm({ ...paymentForm, dispenserId: e.target.value })} className={inputCls} required>
                <option value="">Select...</option>
                {reference.dispensers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Cash collected" required><NumberInput value={paymentForm.cashCollected} onChange={(e) => setPaymentForm({ ...paymentForm, cashCollected: e.target.value })} required /></Field>
            <FormButtons onCancel={() => setStep('deposits')} submitting={submitting} submitLabel="Add Payment" />
          </form>
        </Card>
      )}

      {step === 'deposits' && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm text-gray-500 mb-4">{depositsDone.length} deposit(s) added. Optional — skip if none.</p>
          <form onSubmit={handleDeposit} className="space-y-4">
            <Field label="Amount" required><NumberInput value={depositForm.amount} onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })} required /></Field>
            <Field label="Bank"><input type="text" value={depositForm.bankName} onChange={(e) => setDepositForm({ ...depositForm, bankName: e.target.value })} className={inputCls} /></Field>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={submitting} className={btnPrimaryCls}>{submitting ? 'Saving...' : 'Add Deposit'}</button>
              <button type="button" onClick={() => { toast.success('Backfill complete for this date'); setStep('setup'); setShiftId(''); setReadingsDone([]); setDeliveriesDone([]); setDipsDone([]); setPaymentsDone([]); setDepositsDone([]); }} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                Done — Finish
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
