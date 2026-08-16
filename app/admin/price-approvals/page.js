'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, Tabs, StatusPill, OtpField, theadCls, tableScrollCls, tableActionCls, inputCls } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'all', label: 'History' },
];

// Ported from petrol-station-app's Price Approvals — a non-owner's price change (lib/pricing.js's
// setPrice) already lands as a `pending` PriceHistory row rather than applying immediately; this is
// the review screen that was missing to actually see and decide on those, owner-only (can()'s
// 'pricing.approve' resolves true only for the owner role's wildcard).
export default function PriceApprovalsPage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [decidingFor, setDecidingFor] = useState(null); // row
  const [decision, setDecision] = useState('approved');
  const [adminNote, setAdminNote] = useState('');
  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/pricing?status=${tab === 'pending' ? 'pending' : 'all'}`);
    const d = await r.json();
    if (d.success) setRows(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const openDecide = (row, dec) => {
    setDecidingFor(row); setDecision(dec); setAdminNote(''); setOtp('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/pricing/${decidingFor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: decision, adminNote, otp }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(decision === 'approved' ? 'Price change approved' : 'Price change rejected');
        setDecidingFor(null); load();
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!rows) return <Loader />;

  return (
    <div>
      <PageHeader title="Price Approvals" subtitle="Price changes proposed by non-owner staff, awaiting your decision" />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Product</th>
                <th className="px-4 py-3 text-right font-medium">Old Price</th>
                <th className="px-4 py-3 text-right font-medium">New Price</th>
                <th className="px-4 py-3 text-left font-medium">Reason</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && <EmptyRow colSpan={7} text={tab === 'pending' ? 'No price changes awaiting approval' : 'No price change history'} />}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{r.product?.name || '—'}</td>
                  <td className="px-4 py-3 text-right">{r.oldPrice != null ? formatMoney(r.oldPrice / 100) : '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(r.newPrice / 100)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} color={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'} />
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    {r.status === 'pending' && (
                      <>
                        <button onClick={() => openDecide(r, 'approved')} className={tableActionCls}>Approve</button>
                        <button onClick={() => openDecide(r, 'rejected')} className="text-sm font-medium text-red-700 hover:text-red-800">Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!decidingFor} onClose={() => setDecidingFor(null)} title={`${decision === 'approved' ? 'Approve' : 'Reject'} Price Change`}>
        {decidingFor && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">
              {decidingFor.product?.name}: {decidingFor.oldPrice != null ? formatMoney(decidingFor.oldPrice / 100) : '—'} → <span className="font-semibold">{formatMoney(decidingFor.newPrice / 100)}</span>
            </p>
            <Field label="Note (optional)">
              <textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} className={inputCls} rows={2} />
            </Field>
            <Field label="Verification code" required>
              <OtpField purpose="price_approval" value={otp} onChange={setOtp} />
            </Field>
            <FormButtons onCancel={() => setDecidingFor(null)} submitting={submitting || !otp} submitLabel={decision === 'approved' ? 'Approve' : 'Reject'} />
          </form>
        )}
      </Modal>
    </div>
  );
}
