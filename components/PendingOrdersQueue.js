'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Loader, Card, EmptyState, Modal, FormButtons, Field, inputCls, btnPrimaryCls, ReportToolbar, OtpField, NumberInput } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { useAdminCounts } from '@/components/shell/AdminCountsProvider';

// Self-service orders placed from the customer portal (app/portal/shop) — sit here until confirmed
// (applies stock/credit) or rejected (no stock/credit was ever applied, so rejecting is just a
// status flip). See lib/sale.js.
export default function PendingOrdersQueue({ onChange }) {
  const { data: authSession } = useSession();
  const [orders, setOrders] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creditWarning, setCreditWarning] = useState(null); // { orderId, shortfall, error }
  const [overridePin, setOverridePin] = useState('');
  const [editing, setEditing] = useState(null);
  const { refresh: refreshCounts } = useAdminCounts();
  const canEditPrice = ['owner', 'manager', 'materials_manager'].includes(authSession?.user?.role);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/pending-orders');
      const d = await r.json();
      if (d.success) { setOrders(d.data); setLoadFailed(false); }
      else { setLoadFailed(true); toast.error(d.error || 'Failed to load'); }
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A confirm/reject/re-price changes the sidebar and strip badges and, on /admin/orders, the list below.
  const reload = useCallback(async () => { await load(); refreshCounts(); onChange?.(); }, [load, refreshCounts, onChange]);

  const confirm = async (orderId, overrideCredit = false, otp = '') => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/pending-orders/${orderId}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrideCredit, otp }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(d.data.flagged ? 'Order confirmed — flagged for credit override' : 'Order confirmed');
        setCreditWarning(null); setOverridePin(''); reload();
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
      const r = await fetch(`/api/admin/pending-orders/${orderId}/reject`, { method: 'POST' });
      const d = await r.json();
      if (d.success) { toast.success('Order rejected'); reload(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const savePrices = async (event) => {
    event.preventDefault();
    if (!editing.otp) return toast.error('Send and enter the verification code first');
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/pending-orders/${editing.id}/price`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: editing.revision, reason: editing.reason, otp: editing.otp,
          lines: editing.lines.map((line) => ({ id: line.id, unitPrice: line.unitPrice })) }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Order prices updated'); setEditing(null); reload(); }
      else toast.error(d.error);
    } finally { setSubmitting(false); }
  };

  if (!orders) {
    if (!loadFailed) return <Loader />;
    return <Card><EmptyState title="Could not load pending orders" action={<button type="button" onClick={load} className="text-sm underline">Try again</button>} /></Card>;
  }

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
                {o.transportFee > 0 && <li>Transport — {formatMoney(o.transportFee / 100)}</li>}
              </ul>

              {creditWarning?.orderId === o.id && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                  <p className="font-medium mb-1">Credit limit exceeded</p>
                  <p className="mb-2">{creditWarning.error}</p>
                  <div className="mb-2">
                    <OtpField purpose="credit_override" value={overridePin} onChange={setOverridePin} />
                  </div>
                  <button onClick={() => confirm(o.id, true, overridePin)} disabled={submitting || !overridePin} className="text-xs font-medium text-amber-900 underline disabled:opacity-50">
                    Confirm anyway (this will be flagged for the Admin)
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                {canEditPrice && <button onClick={() => setEditing({ id: o.id, revision: o.deliveryRevision, reason: '', otp: '',
                  lines: o.lines.map((line) => ({ id: line.id, name: line.product.name, qty: line.qty, unitPrice: (line.unitPrice / 100).toFixed(2) })) })}
                  disabled={submitting} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">Edit Prices</button>}
                <button onClick={() => confirm(o.id, false)} disabled={submitting} className={btnPrimaryCls}>Confirm</button>
                <button onClick={() => reject(o.id)} disabled={submitting} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50 text-red-600">Reject</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Requested Prices">
        {editing && <form onSubmit={savePrices} className="space-y-4">
          <p className="text-sm text-gray-600">The customer request stays pending until staff confirms it. Enter the agreed unit prices. Changing a price needs a verification code, and the Admin and managers are told.</p>
          {editing.lines.map((line, index) => <Field key={line.id} label={`${line.name} · ${line.qty} units`}>
            <NumberInput required min="0" step="0.01" value={line.unitPrice} onChange={(event) => setEditing((current) => ({ ...current,
              lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: event.target.value } : item) }))} />
          </Field>)}
          <Field label="Reason"><input required minLength={3} value={editing.reason} onChange={(event) => setEditing((current) => ({ ...current, reason: event.target.value }))} className={inputCls} /></Field>
          <OtpField purpose="sale_discount" value={editing.otp} onChange={(otp) => setEditing((current) => ({ ...current, otp }))} />
          <FormButtons onCancel={() => setEditing(null)} submitting={submitting} submitLabel="Save Prices" />
        </form>}
      </Modal>
    </div>
  );
}
