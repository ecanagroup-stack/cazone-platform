'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, ReportToolbar, NumberInput } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const BUCKET_LABELS = { current: 'Current (0-30d)', d1_30: '31-60d', d31_60: '61-90d', d61_90: '91-120d', d90_plus: '120d+' };

export default function CustomerDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', reference: '' });
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ creditLimit: '', onHold: false });
  const [submitting, setSubmitting] = useState(false);
  const [portalCreds, setPortalCreds] = useState(null); // { loginId, password, reset } shown once

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/customers/${id}`);
    const d = await r.json();
    if (d.success) { setData(d.data); setEditForm({ creditLimit: (d.data.customer.creditLimit / 100).toString(), onHold: d.data.customer.onHold }); }
    else toast.error(d.error || 'Failed to load');
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handlePayment = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/customers/${id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(Number(paymentForm.amount) * 100), method: paymentForm.method, reference: paymentForm.reference }),
      });
      const d = await r.json();
      if (d.success) {
        const msg = d.data.unallocated > 0 ? `Payment recorded — ${formatMoney(d.data.unallocated / 100)} left as unallocated credit` : 'Payment recorded and allocated';
        toast.success(msg);
        setShowPayment(false); setPaymentForm({ amount: '', method: 'cash', reference: '' }); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnablePortal = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/customers/${id}/portal-access`, { method: 'POST' });
      const d = await r.json();
      if (d.success) { setPortalCreds(d.data); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokePortal = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/customers/${id}/portal-access`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) { toast.success('Portal login revoked'); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/customers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditLimit: Math.round(Number(editForm.creditLimit) * 100), onHold: editForm.onHold }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Saved'); setShowEdit(false); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) return <Loader />;

  const { customer, ledger, buckets } = data;
  const available = customer.creditLimit - customer.balance;

  return (
    <div>
      <Link href="/admin/customers" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <FiArrowLeft size={14} /> All Customers
      </Link>

      <PageHeader
        title={customer.name}
        subtitle={customer.businessName || customer.phone || ''}
        action={
          <div className="flex gap-2">
            <button onClick={() => setShowEdit(true)} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">Edit</button>
            {customer.userId && customer.user?.isActive ? (
              <button onClick={handleRevokePortal} disabled={submitting} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50 text-red-600">Revoke Portal Login</button>
            ) : (
              <button onClick={handleEnablePortal} disabled={submitting} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">
                {customer.userId ? 'Reactivate Portal Login' : 'Enable Portal Login'}
              </button>
            )}
            <button onClick={() => setShowPayment(true)} className={btnPrimaryCls}>Record Payment</button>
          </div>
        }
      />

      {customer.onHold && <Card className="p-3 mb-4 border-red-300 bg-red-50 text-sm text-red-800">This account is on hold — new credit sales are blocked.</Card>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-4"><p className="text-xs text-gray-500">Balance</p><p className="text-2xl font-bold mt-1">{formatMoney(customer.balance / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Credit Limit</p><p className="text-2xl font-bold mt-1">{formatMoney(customer.creditLimit / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Available</p><p className={`text-2xl font-bold mt-1 ${available < 0 ? 'text-red-600' : ''}`}>{formatMoney(available / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Status</p><div className="mt-1">{customer.onHold ? <StatusPill status="On Hold" color="red" /> : <StatusPill status="Active" color="green" />}</div></Card>
      </div>

      <Card className="p-5 mb-6">
        <h3 className="font-semibold text-sm mb-4">Ageing (open credit balance, by sale date)</h3>
        <div className="grid grid-cols-5 gap-3 text-center">
          {Object.entries(BUCKET_LABELS).map(([key, label]) => (
            <div key={key}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-sm font-semibold mt-1 ${buckets[key] > 0 ? 'text-amber-700' : ''}`}>{formatMoney(buckets[key] / 100)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm">Statement</h3>
          <ReportToolbar
            title={`${customer.name} — Statement`}
            csvFilename={`${customer.name}-statement`}
            csvRows={ledger}
            csvColumns={[
              { key: 'date', label: 'Date', value: (r) => formatDate(r.date) },
              { key: 'label', label: 'Entry' },
              { key: 'channel', label: 'Channel' },
              { key: 'amount', label: 'Amount', value: (r) => (r.amount / 100).toFixed(2) },
              { key: 'runningBalance', label: 'Balance', value: (r) => (r.runningBalance / 100).toFixed(2) },
            ]}
          />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Entry</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ledger.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-gray-500">No activity yet</td></tr>}
            {ledger.map((entry) => (
              <tr key={`${entry.type}-${entry.id}`}>
                <td className="px-4 py-2 text-gray-500">{formatDate(entry.date)}</td>
                <td className="px-4 py-2">
                  {entry.label}
                  {entry.channel === 'shop' && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">General Store</span>}
                </td>
                <td className={`px-4 py-2 text-right ${entry.amount < 0 ? 'text-green-700' : ''}`}>{formatMoney(entry.amount / 100)}</td>
                <td className="px-4 py-2 text-right font-medium">{formatMoney(entry.runningBalance / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={showPayment} onClose={() => setShowPayment(false)} title="Record Payment">
        <form onSubmit={handlePayment} className="space-y-4">
          <p className="text-sm text-gray-500">Allocated oldest sale first automatically; anything left over stays as credit on the account.</p>
          <Field label="Amount" required>
            <NumberInput value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} required autoFocus />
          </Field>
          <Field label="Method">
            <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })} className={inputCls}>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="pos">POS</option>
              <option value="cheque">Cheque</option>
            </select>
          </Field>
          <Field label="Reference">
            <input type="text" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} className={inputCls} />
          </Field>
          <FormButtons onCancel={() => setShowPayment(false)} submitting={submitting} submitLabel="Record Payment" />
        </form>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Customer">
        <form onSubmit={handleEdit} className="space-y-4">
          <Field label="Credit limit" required>
            <NumberInput value={editForm.creditLimit} onChange={(e) => setEditForm({ ...editForm, creditLimit: e.target.value })} required />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editForm.onHold} onChange={(e) => setEditForm({ ...editForm, onHold: e.target.checked })} />
            On hold (blocks new credit sales)
          </label>
          <FormButtons onCancel={() => setShowEdit(false)} submitting={submitting} submitLabel="Save" />
        </form>
      </Modal>

      <Modal open={!!portalCreds} onClose={() => setPortalCreds(null)} title="Portal Login">
        {portalCreds && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              {portalCreds.reset ? 'Password reset — share the new one with the customer.' : 'Share these with the customer — this password is shown only once.'}
            </p>
            <div className="bg-gray-50 border rounded p-4 space-y-2 font-mono text-sm">
              <p><span className="text-gray-500">Login:</span> {portalCreds.loginId}</p>
              <p><span className="text-gray-500">Password:</span> {portalCreds.password}</p>
            </div>
            <button onClick={() => setPortalCreds(null)} className={btnPrimaryCls + ' w-full'}>Done</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
