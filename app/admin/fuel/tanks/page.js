'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, EmptyState, Modal, FormButtons, Field, Tabs,
  inputCls, btnPrimaryCls, tableActionCls, theadCls, tableScrollCls, StatusPill, NumberInput,
} from '@/components/ui';
import { formatDate } from '@/lib/format';

const TABS = [
  { key: 'tanks', label: 'Tanks & Dispensers' },
  { key: 'attendants', label: 'Attendants' },
  { key: 'terminals', label: 'POS Terminals' },
  { key: 'config', label: 'Station Config' },
];

// "Fuel Setup" — tanks/dispensers/dip, attendants, POS terminals and branch-level config are all
// branch-level fuel settings, nothing operational happens on any tab, so they share one Manage
// sidebar slot.
export default function FuelSetupPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';
  const tabParam = searchParams.get('tab');
  const activeTab = ['attendants', 'terminals', 'config'].includes(tabParam) ? tabParam : 'tanks';

  const setTab = (key) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === 'tanks') params.delete('tab'); else params.set('tab', key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div>
      <PageHeader title="Fuel Setup" subtitle="Tanks, dispensers, attendants, POS terminals and station config for this branch" />
      <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      {!branchId ? (
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to see and manage its fuel setup." /></Card>
      ) : activeTab === 'tanks' ? (
        <TanksTab branchId={branchId} />
      ) : activeTab === 'attendants' ? (
        <AttendantsTab branchId={branchId} />
      ) : activeTab === 'terminals' ? (
        <TerminalsTab branchId={branchId} />
      ) : (
        <ConfigTab branchId={branchId} />
      )}
    </div>
  );
}

const blankTank = { label: '', capacity: '', productId: '', newProductName: '' };
const blankDispenser = { label: '' };

function TanksTab({ branchId }) {
  const [data, setData] = useState(null); // { tanks, products }
  const [showTankModal, setShowTankModal] = useState(false);
  const [tankForm, setTankForm] = useState(blankTank);
  const [addDispenserFor, setAddDispenserFor] = useState(null); // tank object
  const [dispenserForm, setDispenserForm] = useState(blankDispenser);
  const [submitting, setSubmitting] = useState(false);

  const [dipFor, setDipFor] = useState(null); // tank object
  const [measured, setMeasured] = useState('');
  const [dipResult, setDipResult] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/fuel/tanks?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleAddTank = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/tanks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, ...tankForm }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Tank added'); setShowTankModal(false); setTankForm(blankTank); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddDispenser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/dispensers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tankId: addDispenserFor.id, ...dispenserForm }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Dispenser added'); setAddDispenserFor(null); setDispenserForm(blankDispenser); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTank = async (tank) => {
    const r = await fetch(`/api/admin/fuel/tanks/${tank.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !tank.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  const toggleDispenser = async (dispenser) => {
    const r = await fetch(`/api/admin/fuel/dispensers/${dispenser.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !dispenser.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  const handleRecordDip = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/tanks/${dipFor.id}/reconcile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ measured: Number(measured) }),
      });
      const d = await r.json();
      if (d.success) {
        setDipResult(d.data);
        toast[d.data.status === 'exception' ? 'error' : 'success'](
          d.data.status === 'exception' ? `Variance of ${d.data.variance.toFixed(1)}L flagged for review` : 'Within tolerance'
        );
        load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const closeDipModal = () => { setDipFor(null); setMeasured(''); setDipResult(null); };

  if (!data) return <Loader />;

  const { tanks, products } = data;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => { setTankForm(blankTank); setShowTankModal(true); }} className={btnPrimaryCls}>Add Tank</button>
      </div>

      <div className="space-y-6">
        {tanks.length === 0 && <Card className="p-6 text-center text-sm text-gray-500">No tanks yet — add one to get started.</Card>}
        {tanks.map((tank) => (
          <Card key={tank.id} className="overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">
                  {tank.label} <span className="text-xs text-gray-400 font-normal">— {tank.product.name}, {tank.capacity.toLocaleString()} L capacity</span>
                </p>
                <p className="text-xs text-gray-500">
                  {tank.dispensers.length} dispenser{tank.dispensers.length === 1 ? '' : 's'} · <span className="font-medium text-gray-700">{tank.onHand.toLocaleString()} L on hand (book)</span>
                </p>
                {tank.lastReconciliation && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Last dip {formatDate(tank.lastReconciliation.periodEnd)}: {tank.lastReconciliation.measured.toLocaleString()} L
                    {tank.lastReconciliation.status === 'exception' && <span className="text-amber-700 font-medium"> — variance flagged</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusPill status={tank.isActive ? 'Active' : 'Inactive'} color={tank.isActive ? 'green' : 'gray'} />
                <button onClick={() => { setDipFor(tank); setMeasured(''); setDipResult(null); }} className={tableActionCls}>Record Dip</button>
                <button onClick={() => toggleTank(tank)} className={tableActionCls}>{tank.isActive ? 'Deactivate' : 'Reactivate'}</button>
                <button onClick={() => { setAddDispenserFor(tank); setDispenserForm(blankDispenser); }} className={tableActionCls}>+ Add Dispenser</button>
              </div>
            </div>
            <div className="divide-y">
              {tank.dispensers.length === 0 && <p className="px-4 py-4 text-sm text-gray-500">No dispensers yet.</p>}
              {tank.dispensers.map((d) => (
                <div key={d.id} className="px-4 py-3 flex items-center justify-between">
                  <p className="text-sm font-medium">{d.label}</p>
                  <div className="flex items-center gap-3">
                    <StatusPill status={d.isActive ? 'Active' : 'Inactive'} color={d.isActive ? 'green' : 'gray'} />
                    <button onClick={() => toggleDispenser(d)} className={tableActionCls}>{d.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={showTankModal} onClose={() => setShowTankModal(false)} title="Add Tank">
        <form onSubmit={handleAddTank} className="space-y-4">
          <Field label="Tank label" required>
            <input type="text" value={tankForm.label} onChange={(e) => setTankForm({ ...tankForm, label: e.target.value })} className={inputCls} required autoFocus placeholder="e.g., Tank 1" />
          </Field>
          <Field label="Capacity (litres)" required>
            <NumberInput value={tankForm.capacity} onChange={(e) => setTankForm({ ...tankForm, capacity: e.target.value })} required />
          </Field>
          <Field label="Product" required>
            {products.length > 0 ? (
              <select
                value={tankForm.productId}
                onChange={(e) => setTankForm({ ...tankForm, productId: e.target.value, newProductName: '' })}
                className={inputCls}
              >
                <option value="">— New product —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <p className="text-xs text-gray-500 mb-2">No products yet — name one below.</p>
            )}
            {!tankForm.productId && (
              <input
                type="text" value={tankForm.newProductName} onChange={(e) => setTankForm({ ...tankForm, newProductName: e.target.value })}
                className={`${inputCls} mt-2`} placeholder="e.g., PMS (Petrol)" required={!tankForm.productId}
              />
            )}
          </Field>
          <FormButtons onCancel={() => setShowTankModal(false)} submitting={submitting} submitLabel="Add Tank" />
        </form>
      </Modal>

      <Modal open={!!addDispenserFor} onClose={() => setAddDispenserFor(null)} title={`Add dispenser to ${addDispenserFor?.label || ''}`}>
        <form onSubmit={handleAddDispenser} className="space-y-4">
          <Field label="Dispenser label" required>
            <input type="text" value={dispenserForm.label} onChange={(e) => setDispenserForm({ label: e.target.value })} className={inputCls} required autoFocus placeholder="e.g., Pump 1" />
          </Field>
          <FormButtons onCancel={() => setAddDispenserFor(null)} submitting={submitting} submitLabel="Add Dispenser" />
        </form>
      </Modal>

      <Modal open={!!dipFor} onClose={closeDipModal} title={`Record Dip — ${dipFor?.label || ''}`}>
        {dipResult ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-500">Book stock</p><p className="font-medium">{dipResult.book.toLocaleString()} L</p></div>
              <div><p className="text-xs text-gray-500">Measured</p><p className="font-medium">{dipResult.measured.toLocaleString()} L</p></div>
              <div><p className="text-xs text-gray-500">Variance</p><p className={`font-medium ${dipResult.status === 'exception' ? 'text-amber-700' : ''}`}>{dipResult.variance > 0 ? '+' : ''}{dipResult.variance.toFixed(1)} L ({dipResult.variancePct.toFixed(2)}%)</p></div>
              <div><p className="text-xs text-gray-500">Status</p><p className="font-medium capitalize">{dipResult.status.replace('_', ' ')}</p></div>
            </div>
            {dipResult.status === 'exception' && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                This is outside the {dipResult.tolerance}% tolerance and has been added to Anything Wrong for a manager to acknowledge.
              </p>
            )}
            <button onClick={closeDipModal} className={`w-full ${btnPrimaryCls}`}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleRecordDip} className="space-y-4">
            <p className="text-sm text-gray-500">Enter the physical dip reading in litres — compared against book stock since the last dip.</p>
            <Field label="Measured (litres)" required>
              <NumberInput value={measured} onChange={(e) => setMeasured(e.target.value)} required autoFocus />
            </Field>
            <FormButtons onCancel={closeDipModal} submitting={submitting} submitLabel="Record Dip" />
          </form>
        )}
      </Modal>
    </div>
  );
}

const blankAttendant = { staffNumber: '', name: '', phone: '', position: '', employmentType: 'full_time', dateOfBirth: '', gender: '', employmentDate: '', photoUrl: '' };

function AttendantsTab({ branchId }) {
  const [attendants, setAttendants] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankAttendant);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/fuel/attendants?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setAttendants(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/attendants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, ...form }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowModal(false); setForm(blankAttendant); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (a) => {
    const goingActive = !a.isActive;
    if (!goingActive && !confirm(`Deactivate ${a.name}? Their history stays, they just can't be assigned to a pump.`)) return;
    const r = await fetch(`/api/admin/fuel/attendants/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: goingActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  if (!attendants) return <Loader />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">Pump attendants at this branch — not login accounts, just staff records for assignment.</p>
        <button onClick={() => { setForm(blankAttendant); setShowModal(true); }} className={btnPrimaryCls}>Add Attendant</button>
      </div>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Staff #</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Position</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {attendants.length === 0 && <EmptyRow colSpan={6} text="No attendants yet" />}
              {attendants.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-mono text-xs">{a.staffNumber}</td>
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-gray-500">{a.position || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{a.phone || '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={a.isActive ? 'Active' : 'Inactive'} color={a.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleActive(a)} className={tableActionCls}>{a.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Attendant">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Staff number" required>
              <input type="text" value={form.staffNumber} onChange={(e) => setForm({ ...form, staffNumber: e.target.value })} className={inputCls} required autoFocus />
            </Field>
            <Field label="Name" required>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Position">
              <input type="text" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className={inputCls} placeholder="e.g., Pump Attendant" />
            </Field>
          </div>
          <Field label="Employment type">
            <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })} className={inputCls}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="casual">Casual</option>
            </select>
          </Field>
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">HR details (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of birth">
                <input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Gender">
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className={inputCls}>
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Field label="Employment date">
                <input type="date" value={form.employmentDate} onChange={(e) => setForm({ ...form, employmentDate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Photo URL">
                <input type="text" value={form.photoUrl} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} className={inputCls} placeholder="Optional" />
              </Field>
            </div>
          </div>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Attendant" />
        </form>
      </Modal>
    </div>
  );
}

const blankTerminal = { label: '', terminalId: '', provider: '' };

function TerminalsTab({ branchId }) {
  const [terminals, setTerminals] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankTerminal);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/fuel/pos-terminals?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setTerminals(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/pos-terminals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, ...form }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.label} added`); setShowModal(false); setForm(blankTerminal); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (t) => {
    const r = await fetch(`/api/admin/fuel/pos-terminals/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !t.isActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  if (!terminals) return <Loader />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">Card/transfer terminals cashiers can record POS payments against.</p>
        <button onClick={() => { setForm(blankTerminal); setShowModal(true); }} className={btnPrimaryCls}>Add Terminal</button>
      </div>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Label</th>
                <th className="px-4 py-3 text-left font-medium">Terminal ID</th>
                <th className="px-4 py-3 text-left font-medium">Provider</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {terminals.length === 0 && <EmptyRow colSpan={5} text="No POS terminals yet" />}
              {terminals.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium">{t.label}</td>
                  <td className="px-4 py-3 text-gray-500">{t.terminalId || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{t.provider || '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={t.isActive ? 'Active' : 'Inactive'} color={t.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleActive(t)} className={tableActionCls}>{t.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add POS Terminal">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Label" required>
            <input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} required autoFocus placeholder="e.g., Moniepoint 1" />
          </Field>
          <Field label="Terminal ID">
            <input type="text" value={form.terminalId} onChange={(e) => setForm({ ...form, terminalId: e.target.value })} className={inputCls} placeholder="Optional" />
          </Field>
          <Field label="Provider">
            <input type="text" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className={inputCls} placeholder="e.g., Moniepoint, Paystack" />
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Terminal" />
        </form>
      </Modal>
    </div>
  );
}

const DEFAULT_TOLERANCE_PCT = 0.5;

// F1 — the one branch-level setting petrol-station-app's Stations page had (per-station reconciliation
// tolerance) that this app deferred to a flat 0.5% default (see the tank-dip and delivery-offload
// routes). Everything else that page did — creating/renaming a branch, assigning tanks/pumps/products —
// already has its own proper home here (Services & Branches, Tanks & Dispensers above), so this tab
// stays deliberately small rather than re-building a whole "station" concept that doesn't fit cazone's
// branch model.
function ConfigTab({ branchId }) {
  const [branch, setBranch] = useState(null);
  const [tolerance, setTolerance] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/branches/${branchId}`);
    const d = await r.json();
    if (d.success) { setBranch(d.data); setTolerance(String(d.data.config?.reconciliationTolerancePct ?? DEFAULT_TOLERANCE_PCT)); }
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/branches/${branchId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { reconciliationTolerancePct: Number(tolerance) } }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Station config saved'); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!branch) return <Loader />;

  return (
    <Card className="p-4 max-w-md">
      <h3 className="font-semibold text-sm mb-1">Reconciliation Tolerance</h3>
      <p className="text-xs text-gray-500 mb-4">
        How far a tank dip or tanker offload can vary from the book figure before it's flagged for review, as a percentage. Applies to both tank dips (Tanks &amp; Dispensers) and delivery offload checks (Deliveries) at this branch.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Tolerance (%)" required>
          <NumberInput value={tolerance} onChange={(e) => setTolerance(e.target.value)} required />
        </Field>
        <button type="submit" disabled={submitting} className={btnPrimaryCls}>{submitting ? 'Saving...' : 'Save'}</button>
      </form>
    </Card>
  );
}
