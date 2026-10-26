'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { PageHeader, Card, EmptyState, Field, FormButtons, inputCls, btnPrimaryCls, tableActionCls, NumberInput, OtpField } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { fmtL } from '@/app/admin/deliveries/FuelOffload';

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function timeOf(iso) {
  return new Date(iso).toISOString().slice(11, 16);
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

const blankShiftForm = { shiftLabel: '', openTime: '08:00', closeTime: '20:00', openingFloat: '' };
const blankDeliveryForm = { productId: '', tankId: '', declaredLoad: '', actualLitres: '', costPerUnit: '', supplierName: '', vehicleId: '', driverName: '', driverPhone: '' };
const blank = (value) => value === '' || value == null;

// Shortage / excess of what was received against the waybill, as the old backfill form hinted it.
// Nothing at all until both figures are in: without a declared load there is no claim to make.
function deliveryHint(declaredLoad, actualLitres) {
  if (blank(declaredLoad) || blank(actualLitres)) return null;
  const variance = Math.round((Number(actualLitres) - Number(declaredLoad)) * 1000) / 1000;
  if (!Number.isFinite(variance)) return null;
  if (variance === 0) return { tone: 'text-emerald-600', text: 'No shortage: the full expected litres were discharged.' };
  return variance < 0
    ? { tone: 'text-red-600', text: `Driver shortage: ${fmtL(-variance)} L less than the expected litres` }
    : { tone: 'text-emerald-600', text: `Excess: ${fmtL(variance)} L more than the expected litres` };
}

// Historical data entry for any Petrol Station business. A date can have any number of real shifts
// at whatever times actually happened. OTP verification protects each new historical shift.
export default function BackfillPage() {
  const searchParams = useSearchParams();
  const branchIdFromUrl = searchParams.get('branch') || '';
  const { data: session } = useSession();

  const [step, setStep] = useState('setup');
  const [date, setDate] = useState(yesterdayIso());
  const [branchId, setBranchId] = useState(branchIdFromUrl);
  const [reference, setReference] = useState(null); // dispensers, attendants, products, tanks
  const [existingShifts, setExistingShifts] = useState(null);
  const [activeShift, setActiveShift] = useState(null); // the shift currently being added to

  const [otp, setOtp] = useState('');
  const [shiftForm, setShiftForm] = useState(blankShiftForm);
  const [assignForm, setAssignForm] = useState({}); // dispenserId -> { attendantId, opening }
  const [tankOpenings, setTankOpenings] = useState({}); // tankId -> opening dip in litres
  const [submitting, setSubmitting] = useState(false);

  const [readingForm, setReadingForm] = useState({ dispenserId: '', closing: '', rtt: '0', price: '' });
  const [readingsDone, setReadingsDone] = useState([]);

  const [deliveryForm, setDeliveryForm] = useState(blankDeliveryForm);
  const [savedDeliveries, setSavedDeliveries] = useState([]); // this shift's saved historical deliveries
  const [vehicles, setVehicles] = useState([]);
  const [editingDeliveryId, setEditingDeliveryId] = useState(null);

  const [dipForm, setDipForm] = useState({ tankId: '', measured: '' });
  const [dipsDone, setDipsDone] = useState([]);

  const [paymentForm, setPaymentForm] = useState({ dispenserId: '', cashCollected: '' });
  const [paymentsDone, setPaymentsDone] = useState([]);

  const [depositForm, setDepositForm] = useState({ amount: '', bankName: '' });
  const [depositsDone, setDepositsDone] = useState([]);

  useEffect(() => {
    if (!branchId) { setReference(null); return; }
    fetch(`/api/admin/fuel/shift?branchId=${branchId}`).then((r) => r.json()).then((d) => {
      if (d.success) setReference({ dispensers: d.data.dispensers || [], attendants: d.data.attendants || [], products: d.data.products || [], tanks: d.data.tanks || [] });
    });
  }, [branchId]);

  const loadExistingShifts = useCallback(async () => {
    if (!branchId || !date) return;
    const r = await fetch(`/api/admin/fuel/day-detail?branchId=${branchId}&date=${date}`);
    const d = await r.json();
    if (d.success) setExistingShifts(d.data.shifts.filter((s) => s.shift.isBackfill).map((s) => s.shift));
  }, [branchId, date]);

  useEffect(() => { if (step === 'shift') loadExistingShifts(); }, [step, loadExistingShifts]);

  // Only an owner or manager may change a saved delivery (the server enforces it too).
  const canEditDeliveries = ['owner', 'manager'].includes(session?.user?.role);

  const loadDeliveries = useCallback(async () => {
    if (!activeShift) return;
    const r = await fetch(`/api/admin/fuel/backfill?shiftId=${activeShift.id}`);
    const d = await r.json();
    if (d.success) { setSavedDeliveries(d.data.deliveries); setVehicles(d.data.vehicles); }
  }, [activeShift]);

  useEffect(() => { if (step === 'deliveries') loadDeliveries(); }, [step, loadDeliveries]);

  const submitStep = async (body) => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, date }),
      });
      const d = await r.json();
      if (!d.success) { toast.error(d.error); return null; }
      return d.reused ? { ...d.data, reused: true } : d.data;
    } finally {
      setSubmitting(false);
    }
  };

  const selectShift = (shift) => {
    setActiveShift(shift);
    setStep('readings');
  };

  const handleShift = async (e) => {
    e.preventDefault();
    const touched = Object.entries(assignForm).filter(([, v]) => v.attendantId || (v.opening !== undefined && v.opening !== ''));
    const incomplete = touched.find(([, v]) => !v.attendantId || v.opening === undefined || v.opening === '');
    if (incomplete) return toast.error('Every pump you started filling in needs both an attendant and an opening reading — finish it or clear both fields to skip it');
    const assignments = touched.map(([dispenserId, v]) => ({ dispenserId, attendantId: v.attendantId, opening: v.opening }));
    if (assignments.length === 0) return toast.error('Assign at least one pump — pick an attendant and enter an opening reading for at least one row above');
    const activeTanks = reference?.tanks || [];
    const missingTankOpening = activeTanks.find((tank) => tankOpenings[tank.id] === undefined || tankOpenings[tank.id] === '');
    if (missingTankOpening) return toast.error(`Enter the opening stock for ${missingTankOpening.label}`);
    const tankOpeningEntries = activeTanks.map((tank) => ({ tankId: tank.id, measured: tankOpenings[tank.id] }));
    const data = await submitStep({
      type: 'shift', branchId, shiftLabel: shiftForm.shiftLabel, openTime: shiftForm.openTime, closeTime: shiftForm.closeTime,
      openingFloat: Number(shiftForm.openingFloat) || 0, assignments, tankOpenings: tankOpeningEntries, otp,
    });
    if (data) {
      toast.success(data.reused ? 'Continuing that shift' : 'Shift added');
      setActiveShift(data); setOtp(''); setShiftForm(blankShiftForm); setAssignForm({}); setTankOpenings({});
      setStep('readings');
    }
  };

  const handleReading = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'reading', shiftId: activeShift.id, dispenserId: readingForm.dispenserId, closing: readingForm.closing, rtt: readingForm.rtt, price: Math.round(Number(readingForm.price) * 100) });
    if (data) { toast.success('Reading added'); setReadingsDone((r) => [...r, { ...readingForm }]); setReadingForm({ dispenserId: '', closing: '', rtt: '0', price: '' }); }
  };

  const handleDelivery = async (e) => {
    e.preventDefault();
    const f = deliveryForm;
    const data = await submitStep({
      type: editingDeliveryId ? 'updateDelivery' : 'delivery', deliveryId: editingDeliveryId || undefined, shiftId: activeShift.id,
      productId: f.productId, tankId: f.tankId, declaredLoad: f.declaredLoad, actualLitres: f.actualLitres,
      costPerUnit: blank(f.costPerUnit) ? '' : Math.round(Number(f.costPerUnit) * 100),
      supplierName: f.supplierName, vehicleId: f.vehicleId || undefined, driverName: f.driverName, driverPhone: f.driverPhone,
    });
    if (data) {
      toast.success(editingDeliveryId ? 'Delivery updated' : data.reused ? 'That delivery was already recorded' : 'Delivery added');
      setDeliveryForm(blankDeliveryForm); setEditingDeliveryId(null);
      loadDeliveries();
    }
  };

  const startEditDelivery = (d) => {
    setEditingDeliveryId(d.id);
    setDeliveryForm({
      productId: d.productId, tankId: d.tankId || d.tanks?.[0]?.tankId || '', declaredLoad: d.declaredLoad ?? '', actualLitres: String(d.quantity),
      costPerUnit: d.costPerUnit == null ? '' : String(Number(d.costPerUnit) / 100), supplierName: d.supplier?.name || '',
      vehicleId: d.vehicleId || '', driverName: d.driverName || '', driverPhone: d.driverPhone || '',
    });
  };

  const cancelEditDelivery = () => { setEditingDeliveryId(null); setDeliveryForm(blankDeliveryForm); };

  const handleDeleteDelivery = async (d) => {
    if (!window.confirm(`Delete this ${fmtL(d.quantity)} L ${d.product?.name || ''} delivery? Its litres come back out of stock.`)) return;
    const data = await submitStep({ type: 'deleteDelivery', deliveryId: d.id });
    if (data) {
      toast.success('Delivery deleted');
      if (editingDeliveryId === d.id) cancelEditDelivery();
      loadDeliveries();
    }
  };

  const handleDip = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'dip', shiftId: activeShift.id, tankId: dipForm.tankId, measured: dipForm.measured });
    if (data) { toast.success('Dip added'); setDipsDone((d) => [...d, { ...dipForm }]); setDipForm({ tankId: '', measured: '' }); }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'payment', shiftId: activeShift.id, dispenserId: paymentForm.dispenserId, cashCollected: Math.round(Number(paymentForm.cashCollected) * 100) });
    if (data) { toast.success('Payment added'); setPaymentsDone((p) => [...p, { ...paymentForm }]); setPaymentForm({ dispenserId: '', cashCollected: '' }); }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    const data = await submitStep({ type: 'deposit', shiftId: activeShift.id, amount: Math.round(Number(depositForm.amount) * 100), bankName: depositForm.bankName });
    if (data) { toast.success('Deposit added'); setDepositsDone((d) => [...d, { ...depositForm }]); setDepositForm({ amount: '', bankName: '' }); }
  };

  const finishShift = () => {
    toast.success('Shift complete — add another shift for this date, or start a new date');
    setActiveShift(null); setReadingsDone([]); setSavedDeliveries([]); cancelEditDelivery(); setDipsDone([]); setPaymentsDone([]); setDepositsDone([]);
    setStep('shift');
  };

  const startNewDate = () => {
    setDate(yesterdayIso()); setActiveShift(null); setExistingShifts(null);
    setReadingsDone([]); setSavedDeliveries([]); cancelEditDelivery(); setDipsDone([]); setPaymentsDone([]); setDepositsDone([]);
    setStep('setup');
  };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Historical Entries" subtitle="Enter ordinary station records for a previous operating date" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a fuel branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Historical Entries"
        subtitle={activeShift ? `${date} — ${activeShift.shiftLabel || `Shift ${activeShift.shiftOrder || ''}`} (${timeOf(activeShift.openedAt)}–${timeOf(activeShift.closedAt)})` : 'Record past station days with the same pump, stock, sales, and payment records used today'}
      />

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {STEPS.map((s) => (
          <span key={s.key} className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${step === s.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
            {s.label}
          </span>
        ))}
      </div>

      {step === 'setup' && (
        <div className="space-y-5 max-w-2xl">
          <Card className="p-5">
            <Field label="Date" required>
              <input type="date" value={date} max={yesterdayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <p className="text-xs text-gray-500 mt-2">You can add as many shifts as actually happened on this date — morning, afternoon, night, whatever it was.</p>
            <button onClick={() => setStep('shift')} className={`mt-4 ${btnPrimaryCls}`}>Continue to daily entries</button>
          </Card>
        </div>
      )}

      {step === 'shift' && reference && reference.dispensers.length === 0 && (
        <Card className="p-6 max-w-2xl text-center">
          <p className="text-sm font-medium text-gray-900 mb-1">No pumps set up at this branch yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Entering a historical shift needs at least one tank and dispenser to already exist —
            there's nothing to enter historical readings against otherwise. Set that up once
            (it only takes a minute), then come back here.
          </p>
          <Link href={`/admin/fuel/tanks?branch=${branchId}`} className={btnPrimaryCls}>Go to Fuel Setup</Link>
        </Card>
      )}

      {step === 'shift' && reference && reference.dispensers.length > 0 && (
        <div className="space-y-6 max-w-2xl">
          {existingShifts === null ? null : existingShifts.length > 0 && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">Shifts already added for {date}</h3>
              <div className="space-y-2">
                {existingShifts.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border rounded p-3">
                    <div>
                      <p className="text-sm font-medium">{s.shiftLabel || `Shift ${s.shiftOrder || 1}`}</p>
                      <p className="text-xs text-gray-500">{timeOf(s.openedAt)} – {timeOf(s.closedAt)} · Opening float {formatMoney(s.openingFloat / 100)}</p>
                    </div>
                    <button onClick={() => selectShift(s)} className={tableActionCls}>Continue this shift →</button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-1">Add {existingShifts?.length ? 'another' : 'a'} shift</h3>
            <form onSubmit={handleShift} className="space-y-4 mt-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Shift label"><input type="text" value={shiftForm.shiftLabel} onChange={(e) => setShiftForm({ ...shiftForm, shiftLabel: e.target.value })} className={inputCls} placeholder="e.g. Morning" /></Field>
                <Field label="Open time" required><input type="time" value={shiftForm.openTime} onChange={(e) => setShiftForm({ ...shiftForm, openTime: e.target.value })} className={inputCls} required /></Field>
                <Field label="Close time" required><input type="time" value={shiftForm.closeTime} onChange={(e) => setShiftForm({ ...shiftForm, closeTime: e.target.value })} className={inputCls} required /></Field>
              </div>
              <p className="text-xs text-gray-500 -mt-2">If close time is earlier than open time, it's treated as an overnight shift ending the next day.</p>
              <Field label="Opening float">
                <NumberInput value={shiftForm.openingFloat} onChange={(e) => setShiftForm({ ...shiftForm, openingFloat: e.target.value })} placeholder="Cash that was in the till at the start of this shift" />
              </Field>
              <div>
                <p className="text-sm font-medium mb-2">Opening tank stock</p>
                <p className="text-xs text-gray-500 mb-3">Enter the physical litres in every active tank at the start of this historical shift.</p>
                <div className="space-y-3 mb-5">
                  {(reference.tanks || []).map((tank) => (
                    <div key={tank.id} className="grid grid-cols-2 gap-3 items-center">
                      <p className="text-sm">{tank.label} <span className="text-xs text-gray-400">— {tank.product?.name}</span></p>
                      <NumberInput value={tankOpenings[tank.id] ?? ''} onChange={(e) => setTankOpenings({ ...tankOpenings, [tank.id]: e.target.value })} placeholder="Opening litres" required />
                    </div>
                  ))}
                </div>
                <p className="text-sm font-medium mb-2">Pump assignments</p>
                <p className="text-xs text-gray-500 mb-3">Every pump you enter needs both an attendant and an opening reading. Leave a pump's row completely untouched to skip it for this shift.</p>
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
                    No attendants registered yet — add one from Fuel Setup first.
                  </p>
                )}
              </div>
              <Field label="Verification code" required>
                <OtpField purpose="backfill" value={otp} onChange={setOtp} />
              </Field>
              <button type="submit" disabled={submitting || !otp} className={`${btnPrimaryCls} disabled:opacity-50`}>{submitting ? 'Saving...' : 'Add Shift'}</button>
            </form>
          </Card>
        </div>
      )}

      {step === 'readings' && activeShift && (
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

      {step === 'deliveries' && activeShift && (() => {
        const f = deliveryForm;
        const setF = (patch) => setDeliveryForm({ ...f, ...patch });
        const matchingTanks = (reference.tanks || []).filter((t) => t.productId === f.productId);
        const hint = deliveryHint(f.declaredLoad, f.actualLitres);
        const pickVehicle = (vehicleId) => {
          const vehicle = vehicles.find((v) => v.id === vehicleId);
          setF({ vehicleId, driverName: vehicle?.driverName || '', driverPhone: vehicle?.driverPhone || '' });
        };
        return (
          <div className="max-w-2xl space-y-5">
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1">{savedDeliveries.length} delivery(ies) saved for this shift</h3>
              {savedDeliveries.length === 0 ? (
                <p className="text-xs text-gray-500">None yet. Deliveries are optional — skip if there were none.</p>
              ) : (
                <div className="space-y-2 mt-3">
                  {savedDeliveries.map((d) => (
                    <div key={d.id} className={`border rounded p-3 ${editingDeliveryId === d.id ? 'border-brand-600 bg-brand-50/40' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{d.product?.name} <span className="text-xs font-normal text-gray-500">into {(d.tanks?.length ? d.tanks.map((t) => t.tank?.label) : [d.tank?.label]).filter(Boolean).join(', ') || 'no tank recorded'}</span></p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            Expected {d.declaredLoad != null ? `${fmtL(d.declaredLoad)} L` : '—'} · Discharged {fmtL(d.actualLitres)} L
                            {d.shortage > 0 && <span className="text-red-600 font-medium"> · Shortage {fmtL(d.shortage)} L</span>}
                            {d.excess > 0 && <span className="text-emerald-600 font-medium"> · Excess {fmtL(d.excess)} L</span>}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {[d.supplier?.name, d.vehicle?.plateNumber, d.driverName, d.totalCost != null ? formatMoney(Number(d.totalCost) / 100) : null].filter(Boolean).join(' · ') || 'No supplier, truck or cost recorded'}
                          </p>
                        </div>
                        {canEditDeliveries && (
                          <div className="flex gap-3 shrink-0">
                            <button type="button" onClick={() => startEditDelivery(d)} className={tableActionCls}>Edit</button>
                            <button type="button" onClick={() => handleDeleteDelivery(d)} className="text-xs text-red-600 hover:underline">Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-1">{editingDeliveryId ? 'Edit delivery' : 'Add a delivery'}</h3>
              <p className="text-xs text-gray-500 mb-4">Stock goes up by the actual litres discharged, never the expected litres. Enter both so a driver shortage is recorded. Pick the receiving tank.</p>
              <form onSubmit={handleDelivery} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fuel type" required>
                    <select value={f.productId} onChange={(e) => {
                      const tanksFor = (reference.tanks || []).filter((t) => t.productId === e.target.value);
                      setF({ productId: e.target.value, tankId: tanksFor.length === 1 ? tanksFor[0].id : '' });
                    }} className={inputCls} required>
                      <option value="">Select...</option>
                      {reference.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Receiving tank" required>
                    <select value={f.tankId} onChange={(e) => setF({ tankId: e.target.value })} className={`${inputCls} ${!f.tankId && f.productId ? 'border-amber-300' : ''}`} required>
                      <option value="">Select tank (required)...</option>
                      {matchingTanks.map((t) => <option key={t.id} value={t.id}>{t.label}{t.capacity ? ` (${fmtL(t.capacity)} L)` : ''}</option>)}
                    </select>
                  </Field>
                </div>
                {f.productId && matchingTanks.length === 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">This branch has no tank for that fuel type. Add one from Fuel Setup first.</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Expected litres (L)">
                    <NumberInput value={f.declaredLoad} onChange={(e) => setF({ declaredLoad: e.target.value })} placeholder="Declared load on the waybill" />
                  </Field>
                  <Field label="Actual litres discharged (L)" required>
                    <NumberInput value={f.actualLitres} onChange={(e) => setF({ actualLitres: e.target.value })} placeholder="What really went into the tank" required />
                  </Field>
                </div>
                {hint && <p className={`text-xs font-medium -mt-2 ${hint.tone}`}>{hint.text}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cost per litre">
                    <NumberInput value={f.costPerUnit} onChange={(e) => setF({ costPerUnit: e.target.value })} placeholder="Optional" />
                  </Field>
                  <Field label="Supplier"><input type="text" value={f.supplierName} onChange={(e) => setF({ supplierName: e.target.value })} className={inputCls} placeholder="Optional" /></Field>
                </div>
                {!blank(f.actualLitres) && !blank(f.costPerUnit) && (
                  <p className="text-xs font-medium text-emerald-600 -mt-2">Total cost: {formatMoney(Number(f.actualLitres) * Number(f.costPerUnit))}</p>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Truck">
                    <select value={f.vehicleId} onChange={(e) => pickVehicle(e.target.value)} className={inputCls}>
                      <option value="">None</option>
                      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
                    </select>
                  </Field>
                  <Field label="Driver"><input type="text" value={f.driverName} onChange={(e) => setF({ driverName: e.target.value })} className={inputCls} placeholder="Optional" /></Field>
                  <Field label="Driver phone"><input type="text" value={f.driverPhone} onChange={(e) => setF({ driverPhone: e.target.value })} className={inputCls} placeholder="Optional" /></Field>
                </div>
                <FormButtons onCancel={editingDeliveryId ? cancelEditDelivery : () => setStep('dips')} submitting={submitting} submitLabel={editingDeliveryId ? 'Save Changes' : 'Add Delivery'} />
                {!editingDeliveryId && <p className="text-xs text-gray-500 -mt-2">Cancel skips on to Tank Dips.</p>}
              </form>
            </Card>
          </div>
        );
      })()}

      {step === 'dips' && activeShift && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm text-gray-500 mb-4">{dipsDone.length} dip(s) added for this shift. Optional — skip if none.</p>
          <form onSubmit={handleDip} className="space-y-4">
            <Field label="Tank" required>
              <select value={dipForm.tankId} onChange={(e) => setDipForm({ ...dipForm, tankId: e.target.value })} className={inputCls} required>
                <option value="">Select...</option>
                {(reference.tanks || []).map((tank) => <option key={tank.id} value={tank.id}>{tank.label} — {tank.product?.name}</option>)}
              </select>
            </Field>
            <Field label="Measured (litres)" required><NumberInput value={dipForm.measured} onChange={(e) => setDipForm({ ...dipForm, measured: e.target.value })} required /></Field>
            <FormButtons onCancel={() => setStep('payments')} submitting={submitting} submitLabel="Add Dip" />
          </form>
        </Card>
      )}

      {step === 'payments' && activeShift && (
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

      {step === 'deposits' && activeShift && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm text-gray-500 mb-4">{depositsDone.length} deposit(s) added for this shift. Optional — skip if none.</p>
          <form onSubmit={handleDeposit} className="space-y-4">
            <Field label="Amount" required><NumberInput value={depositForm.amount} onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })} required /></Field>
            <Field label="Bank"><input type="text" value={depositForm.bankName} onChange={(e) => setDepositForm({ ...depositForm, bankName: e.target.value })} className={inputCls} /></Field>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={submitting} className={btnPrimaryCls}>{submitting ? 'Saving...' : 'Add Deposit'}</button>
              <button type="button" onClick={finishShift} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                Done with this shift — add another
              </button>
              <button type="button" onClick={startNewDate} className="text-sm text-gray-500 hover:text-gray-700">
                Start a different date
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
