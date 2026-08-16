'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, Modal, FormButtons, Field, inputCls, btnPrimaryCls, StatusPill, Tabs, ReportToolbar, OtpField } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';

const SEVERITY_COLOR = { info: 'blue', concern: 'amber', issue: 'red' };
const TARGET_LABEL = { Shift: 'Cash-up', Order: 'Sale', Reconciliation: 'Stock variance' };
const TABS = [
  { key: 'flags', label: 'Anything Wrong' },
  { key: 'pending', label: 'Pending Orders' },
  { key: 'pricing', label: 'Price Changes' },
  { key: 'deposits', label: 'Deposits' },
];

export default function ExceptionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = ['pending', 'pricing', 'deposits'].includes(tabParam) ? tabParam : 'flags';

  const setTab = (key) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === 'flags') params.delete('tab'); else params.set('tab', key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div>
      <PageHeader title="Anything Wrong" subtitle="Credit overrides, cash-up differences, stock variances, online orders, price changes, and deposits that need a look" />
      <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      {activeTab === 'flags' ? <FlagsTab /> : activeTab === 'pending' ? <PendingOrdersTab /> : activeTab === 'pricing' ? <PricingTab /> : <DepositsTab />}
    </div>
  );
}

function FlagsTab() {
  const [flags, setFlags] = useState(null);
  const [ackFor, setAckFor] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/exceptions');
    const d = await r.json();
    if (d.success) setFlags(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const handleAcknowledge = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/exceptions/${ackFor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Acknowledged'); setAckFor(null); setNote(''); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!flags) return <Loader />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <ReportToolbar
          title="Anything Wrong"
          csvFilename="anything-wrong"
          csvRows={flags}
          csvColumns={[
            { key: 'createdAt', label: 'Date', value: (r) => formatDate(r.createdAt) },
            { key: 'branchName', label: 'Branch' },
            { key: 'targetType', label: 'Type', value: (r) => TARGET_LABEL[r.targetType] || r.targetType },
            { key: 'severity', label: 'Severity' },
            { key: 'status', label: 'Status' },
            { key: 'reason', label: 'Reason' },
          ]}
        />
      </div>
      {flags.length === 0 ? (
        <Card><EmptyState title="Nothing open" subtitle="Every flag raised across your branches has been acknowledged." /></Card>
      ) : (
        <div className="space-y-3">
          {flags.map((f) => (
            <Card key={f.id} className="p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <StatusPill status={TARGET_LABEL[f.targetType] || f.targetType} color={SEVERITY_COLOR[f.severity] || 'gray'} />
                  {f.branchName && <span className="text-xs text-gray-400">{f.branchName}</span>}
                  <span className="text-xs text-gray-400">{formatDate(f.createdAt)}</span>
                </div>
                <p className="text-sm whitespace-pre-line">{f.reason}</p>
              </div>
              <button
                onClick={() => { setAckFor(f); setNote(''); }}
                className="shrink-0 px-3 py-1.5 border rounded text-sm font-medium hover:bg-gray-50"
              >
                Acknowledge
              </button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!ackFor} onClose={() => setAckFor(null)} title="Acknowledge">
        <form onSubmit={handleAcknowledge} className="space-y-4">
          <p className="text-sm text-gray-500">{ackFor?.reason}</p>
          <Field label="Note" required>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} rows={3} required autoFocus placeholder="What did you check, and what's the resolution?" />
          </Field>
          <FormButtons onCancel={() => setAckFor(null)} submitting={submitting} submitLabel="Acknowledge" />
        </form>
      </Modal>
    </div>
  );
}

// Self-service orders placed from the customer portal (app/portal/shop) — sit here until confirmed
// (applies stock/credit) or rejected (no stock/credit was ever applied, so rejecting is just a
// status flip). See lib/sale.js.
function PendingOrdersTab() {
  const [orders, setOrders] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null); // { orderId, shortfall, error }
  const [overridePin, setOverridePin] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/materials/pending-orders');
    const d = await r.json();
    if (d.success) setOrders(d.data);
    else toast.error(d.error || 'Failed to load');
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirm = async (orderId, overrideCredit = false, otp = '') => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/materials/pending-orders/${orderId}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrideCredit, otp }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.data.flagged ? 'Order confirmed — flagged for credit override' : 'Order confirmed');
        setCreditWarning(null); setOverridePin(''); load();
      } else if (d.needsApproval) {
        setCreditWarning({ orderId, ...d });
      } else {
        toast.error(d.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reject = async (orderId) => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/materials/pending-orders/${orderId}/reject`, { method: 'POST' });
      const d = await r.json();
      if (d.success) { toast.success('Order rejected'); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!orders) return <Loader />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <ReportToolbar
          title="Pending Orders"
          csvFilename="pending-orders"
          csvRows={orders}
          csvColumns={[
            { key: 'orderNumber', label: 'Order #' },
            { key: 'customer.name', label: 'Customer' },
            { key: 'branch.name', label: 'Branch' },
            { key: 'createdAt', label: 'Date', value: (r) => formatDate(r.createdAt) },
            { key: 'grandTotal', label: 'Total', value: (r) => (r.grandTotal / 100).toFixed(2) },
          ]}
        />
      </div>
      {orders.length === 0 ? (
        <Card><EmptyState title="Nothing pending" subtitle="Self-service orders placed from the customer portal will show up here for confirmation." /></Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div>
                  <p className="text-sm font-semibold">{o.orderNumber} — {o.customer?.name || 'Unknown customer'}</p>
                  <p className="text-xs text-gray-500">{o.branch?.name} — {formatDate(o.createdAt)}</p>
                </div>
                <p className="text-sm font-semibold">{formatMoney(o.grandTotal / 100)}</p>
              </div>
              <ul className="text-xs text-gray-500 mb-3">
                {o.lines.map((l) => (
                  <li key={l.id}>{l.qty} × {l.product.name} — {formatMoney(l.lineTotal / 100)}</li>
                ))}
              </ul>

              {creditWarning?.orderId === o.id && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                  <p className="font-medium mb-1">Credit limit exceeded</p>
                  <p className="mb-2">{creditWarning.error}</p>
                  <div className="mb-2">
                    <OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} />
                  </div>
                  <button onClick={() => confirm(o.id, true, overridePin)} disabled={submitting || !overridePin} className="text-xs font-medium text-amber-900 underline disabled:opacity-50">
                    Confirm anyway (this will be flagged for the owner)
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => confirm(o.id, false)} disabled={submitting} className={btnPrimaryCls}>Confirm</button>
                <button onClick={() => reject(o.id)} disabled={submitting} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50 text-red-600">Reject</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Price changes proposed by a manager/staff — the live PriceRule is untouched until an owner
// approves here (lib/pricing.js setPrice). Only owners can act (the API 403s otherwise); staff
// viewing this tab just see what's pending.
function PricingTab() {
  const [rows, setRows] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [decisionFor, setDecisionFor] = useState(null); // { row, status }
  const [pin, setPin] = useState('');

  const load = async () => {
    const r = await fetch('/api/admin/pricing');
    const d = await r.json();
    if (d.success) setRows(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const decide = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/pricing/${decisionFor.row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: decisionFor.status, otp: pin }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(decisionFor.status === 'approved' ? 'Price change approved' : 'Price change rejected');
        setDecisionFor(null); setPin(''); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!rows) return <Loader />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <ReportToolbar
          title="Price Changes"
          csvFilename="price-changes"
          csvRows={rows}
          csvColumns={[
            { key: 'product.name', label: 'Product' },
            { key: 'oldPrice', label: 'Old Price', value: (r) => (r.oldPrice != null ? (r.oldPrice / 100).toFixed(2) : '') },
            { key: 'newPrice', label: 'New Price', value: (r) => (r.newPrice / 100).toFixed(2) },
            { key: 'status', label: 'Status' },
            { key: 'createdAt', label: 'Date', value: (r) => formatDate(r.createdAt) },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <Card><EmptyState title="Nothing pending" subtitle="Price changes proposed by managers or staff will show up here for approval." /></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{row.product.name}</p>
                <p className="text-xs text-gray-500">
                  {row.oldPrice != null ? formatMoney(row.oldPrice / 100) : '—'} → {formatMoney(row.newPrice / 100)} — {formatDate(row.createdAt)}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => { setDecisionFor({ row, status: 'approved' }); setPin(''); }} disabled={submitting} className={btnPrimaryCls}>Approve</button>
                <button onClick={() => { setDecisionFor({ row, status: 'rejected' }); setPin(''); }} disabled={submitting} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50 text-red-600">Reject</button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!decisionFor} onClose={() => setDecisionFor(null)} title={decisionFor?.status === 'approved' ? 'Approve Price Change' : 'Reject Price Change'}>
        <form onSubmit={decide} className="space-y-4">
          <Field label="Verification code" required>
            <OtpField purpose="price_approval" value={pin} onChange={setPin} />
          </Field>
          <FormButtons onCancel={() => setDecisionFor(null)} submitting={submitting} submitLabel={decisionFor?.status === 'approved' ? 'Approve' : 'Reject'} />
        </form>
      </Modal>
    </div>
  );
}

const DEPOSIT_STATUS_COLOR = { pending: 'amber', approved: 'green', rejected: 'red' };
const blankDepositForm = { branchId: '', amount: '', bankName: '', accountNumber: '' };

// Cash deposits staff record after banking a shift's takings — sit `pending` until a manager/owner
// approves or rejects them.
function DepositsTab() {
  const [deposits, setDeposits] = useState(null);
  const [branches, setBranches] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankDepositForm);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/deposits');
    const d = await r.json();
    if (d.success) setDeposits(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => {
    load();
    fetch('/api/admin/services').then((r) => r.json()).then((d) => {
      if (d.success) setBranches(d.data.flatMap((s) => s.branches.map((b) => ({ ...b, serviceName: s.name }))));
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/deposits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Math.round(Number(form.amount || 0) * 100) }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Deposit recorded'); setShowModal(false); setForm(blankDepositForm); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (id, status) => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/deposits/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const d = await r.json();
      if (d.success) { toast.success(status === 'approved' ? 'Deposit approved' : 'Deposit rejected'); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!deposits) return <Loader />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <ReportToolbar
          title="Deposits"
          csvFilename="deposits"
          csvRows={deposits}
          csvColumns={[
            { key: 'createdAt', label: 'Date', value: (r) => formatDate(r.createdAt) },
            { key: 'branch.name', label: 'Branch' },
            { key: 'amount', label: 'Amount', value: (r) => (r.amount / 100).toFixed(2) },
            { key: 'bankName', label: 'Bank' },
            { key: 'accountNumber', label: 'Account' },
            { key: 'status', label: 'Status' },
          ]}
        />
        <button onClick={() => { setForm(blankDepositForm); setShowModal(true); }} className={btnPrimaryCls}>Record Deposit</button>
      </div>

      {deposits.length === 0 ? (
        <Card><EmptyState title="No deposits yet" subtitle="Record a bank deposit and it'll wait here for approval." /></Card>
      ) : (
        <div className="space-y-3">
          {deposits.map((dep) => (
            <Card key={dep.id} className="p-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold">{formatMoney(dep.amount / 100)}</p>
                  <StatusPill status={dep.status} color={DEPOSIT_STATUS_COLOR[dep.status]} />
                </div>
                <p className="text-xs text-gray-500">{dep.branch?.name} — {dep.bankName} ({dep.accountNumber}) — {formatDate(dep.createdAt)}</p>
              </div>
              {dep.status === 'pending' && (
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => decide(dep.id, 'approved')} disabled={submitting} className={btnPrimaryCls}>Approve</button>
                  <button onClick={() => decide(dep.id, 'rejected')} disabled={submitting} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50 text-red-600">Reject</button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Record Deposit">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Branch" required>
            <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className={inputCls} required>
              <option value="">Select...</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.serviceName})</option>)}
            </select>
          </Field>
          <Field label="Amount" required>
            <input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank name" required>
              <input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} className={inputCls} required />
            </Field>
            <Field label="Account number" required>
              <input type="text" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className={inputCls} required />
            </Field>
          </div>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Record Deposit" />
        </form>
      </Modal>
    </div>
  );
}
