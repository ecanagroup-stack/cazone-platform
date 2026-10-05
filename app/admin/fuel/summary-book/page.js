'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, EmptyState, StatusPill, Modal, FormButtons, Field,
  inputCls, tableActionCls, theadCls, tableScrollCls, ReportToolbar, NumberInput,
} from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';
import { operatingDateAt } from '@/lib/fuelCollections.mjs';

function todayIso() {
  return operatingDateAt();
}
function daysAgoIso(n) {
  const d = new Date(`${operatingDateAt()}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Ported from petrol-station-app's Summary Book — the shift-by-shift, product-by-product ledger an
// owner reconciles against: opening stock, what came in, what sold, what closed, and any shortage.
// Clicking a row drills into Day Detail (Part 3) — the old app's Manager/Supervisor/Cashier
// breakdown, read-only here except for the audited correction paths each section links to.
export default function SummaryBookPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';
  const detailDate = searchParams.get('date') || '';

  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    const r = await fetch(`/api/admin/fuel/summary-book?branchId=${branchId}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setRows(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId, from, to]);

  useEffect(() => { load(); }, [load]);

  const openDay = (dateStr) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', dateStr);
    router.push(`${pathname}?${params.toString()}`);
  };

  const closeDay = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('date');
    router.push(`${pathname}?${params.toString()}`);
  };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Summary Book" subtitle="Shift-by-shift, product-by-product reconciliation" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (detailDate) {
    return <DayDetail branchId={branchId} date={detailDate} onBack={closeDay} />;
  }

  return (
    <div>
      <PageHeader title="Summary Book" subtitle="Shift-by-shift, product-by-product reconciliation" />
      <a className="inline-block mb-4 text-sm text-brand-600 underline" href={`/admin/fuel/historical-incomplete?branch=${encodeURIComponent(branchId)}`}>
        Review incomplete historical pump records
      </a>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
      </div>

      {!rows ? <Loader /> : (
        <div>
          <div className="flex justify-end mb-3">
            <ReportToolbar
              title="Summary Book"
              csvFilename="summary-book"
              csvRows={rows}
              csvColumns={[
                { key: 'date', label: 'Date', value: (r) => formatDate(r.date) },
                { key: 'shiftLabel', label: 'Shift' },
                { key: 'product', label: 'Product' },
                { key: 'openingStock', label: 'Opening Stock', value: (r) => r.productId ? r.openingStock : '' },
                { key: 'stockIn', label: 'Stock In', value: (r) => r.productId ? r.stockIn : '' },
                { key: 'sales', label: 'Sales (L)', value: (r) => r.productId ? r.sales : '' },
                { key: 'closingStock', label: 'Closing Stock' },
                { key: 'price', label: 'Price', value: (r) => r.productId ? (r.price / 100).toFixed(2) : '' },
                { key: 'totalAmount', label: 'Revenue', value: (r) => r.productId ? (r.totalAmount / 100).toFixed(2) : '' },
                { key: 'shortage', label: 'Shortage', value: (r) => r.productId ? (r.shortage / 100).toFixed(2) : '' },
                { key: 'unknownCollections', label: 'Unknown Collections' },
                { key: 'incompleteReadings', label: 'Incomplete Pump Readings' },
              ]}
            />
          </div>
          <Card className="overflow-hidden">
            <div className={tableScrollCls}>
              <table className="w-full text-sm">
                <thead className={theadCls}>
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Shift</th>
                    <th className="px-4 py-3 text-left font-medium">Product</th>
                    <th className="px-4 py-3 text-right font-medium">Opening</th>
                    <th className="px-4 py-3 text-right font-medium">Stock In</th>
                    <th className="px-4 py-3 text-right font-medium">Sales (L)</th>
                    <th className="px-4 py-3 text-right font-medium">Closing</th>
                    <th className="px-4 py-3 text-right font-medium">Price</th>
                    <th className="px-4 py-3 text-right font-medium">Revenue</th>
                    <th className="px-4 py-3 text-right font-medium">Shortage</th>
                    <th className="px-4 py-3 text-right font-medium">Incomplete</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.length === 0 && <EmptyRow colSpan={11} text="No shift activity in this range" />}
                  {rows.map((r, i) => {
                    const dateStr = r.date.slice(0, 10);
                    return (
                      <tr key={i} className={`cursor-pointer hover:bg-gray-50 ${r.shortage > 0 ? 'bg-amber-50' : ''}`} onClick={() => openDay(dateStr)}>
                        <td className="px-4 py-3 text-brand-600 hover:underline">{formatDate(r.date)}</td>
                        <td className="px-4 py-3 text-gray-500">{r.shiftLabel || (r.shiftOrder ? `Shift ${r.shiftOrder}` : 'Full Day')}</td>
                        <td className="px-4 py-3 font-medium">{r.product}</td>
                        <td className="px-4 py-3 text-right">{r.productId ? `${r.openingStock.toLocaleString()} L` : '—'}</td>
                        <td className="px-4 py-3 text-right">{r.productId ? `${r.stockIn.toLocaleString()} L` : '—'}</td>
                        <td className="px-4 py-3 text-right">{r.productId ? `${r.sales.toLocaleString()} L` : '—'}</td>
                        <td className="px-4 py-3 text-right">{r.closingStock != null ? `${r.closingStock.toLocaleString()} L${r.closingStockSource === 'recorded_dips' ? ' (dip)' : ''}` : '—'}</td>
                        <td className="px-4 py-3 text-right">{r.productId ? formatMoney(r.price / 100) : '—'}</td>
                        <td className="px-4 py-3 text-right font-medium">{r.productId ? formatMoney(r.totalAmount / 100) : '—'}</td>
                        <td className={`px-4 py-3 text-right ${r.shortage > 0 ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>
                          {r.shortage > 0 ? formatMoney(r.shortage / 100) : r.unknownCollections > 0 ? 'Unknown collection' : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">{r.incompleteReadings > 0 ? `${r.incompleteReadings} pending` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

const SECTIONS = [
  { key: 'manager', label: 'Manager Inputs' },
  { key: 'supervisor', label: 'Supervisor Inputs' },
  { key: 'cashier', label: 'Cashier Inputs' },
];

function DayDetail({ branchId, date, onBack }) {
  const { data: session } = useSession();
  const [data, setData] = useState(null);
  const [section, setSection] = useState('supervisor');
  const [correctingDelivery, setCorrectingDelivery] = useState(null);
  const [correctForm, setCorrectForm] = useState({ quantity: '', costPerUnit: '', reason: '' });
  const [correctingReading, setCorrectingReading] = useState(null);
  const [correctReadingForm, setCorrectReadingForm] = useState({ closing: '', rtt: '', reason: '' });
  const [correctingDeposit, setCorrectingDeposit] = useState(null);
  const [correctDepositForm, setCorrectDepositForm] = useState({ amount: '', bankName: '', accountNumber: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [auditComment, setAuditComment] = useState('');
  const [auditClassification, setAuditClassification] = useState('observation');

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/fuel/day-detail?branchId=${branchId}&date=${date}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId, date]);

  useEffect(() => { load(); }, [load]);

  const openCorrect = (delivery) => {
    setCorrectingDelivery(delivery);
    setCorrectForm({ quantity: delivery.quantity.toString(), costPerUnit: (delivery.costPerUnit / 100).toString(), reason: '' });
  };

  const submitCorrect = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/deliveries/${correctingDelivery.id}/correct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: Number(correctForm.quantity), costPerUnit: Math.round(Number(correctForm.costPerUnit) * 100), reason: correctForm.reason }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Delivery corrected'); setCorrectingDelivery(null); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const openCorrectReading = (r) => {
    setCorrectingReading(r);
    setCorrectReadingForm({ closing: r.closing.toString(), rtt: r.rtt.toString(), reason: '' });
  };

  const submitCorrectReading = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/fuel/shift/${correctingReading.shiftId}/dispensers/${correctingReading.dispenserId}/correct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closing: Number(correctReadingForm.closing), rtt: Number(correctReadingForm.rtt),
          reason: correctReadingForm.reason,
        }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Reading corrected'); setCorrectingReading(null); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const openCorrectDeposit = (d) => {
    setCorrectingDeposit(d);
    setCorrectDepositForm({ amount: (d.amount / 100).toString(), bankName: d.bankName || '', accountNumber: d.accountNumber || '', reason: '' });
  };

  const submitCorrectDeposit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/deposits/${correctingDeposit.id}/correct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(Number(correctDepositForm.amount) * 100),
          bankName: correctDepositForm.bankName, accountNumber: correctDepositForm.accountNumber, reason: correctDepositForm.reason,
        }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Deposit corrected'); setCorrectingDeposit(null); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const submitAuditComment = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/fuel/audit-comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, date, comment: auditComment, classification: auditClassification }),
      });
      const result = await response.json();
      if (result.success) { toast.success('Audit comment saved'); setAuditComment(''); load(); }
      else toast.error(result.error || 'Could not save comment');
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) return <Loader />;

  const { shifts, deliveries, reconciliations, tankDips = [], auditComments = [] } = data;
  const canComment = ['auditor', 'daily_auditor', 'external_auditor'].includes(session?.user?.role);

  return (
    <div>
      <PageHeader
        title={`Day Detail — ${formatDate(date)}`}
        subtitle={shifts.length === 0 ? 'No shift activity this day' : `${shifts.length} shift${shifts.length === 1 ? '' : 's'}`}
        action={<button onClick={onBack} className="text-sm font-medium text-brand-600 hover:text-brand-700">← Back to Summary Book</button>}
      />

      <Card className="p-4 mb-4">
        <h3 className="font-semibold text-sm mb-3">Auditor Comments</h3>
        {auditComments.length === 0 && <p className="text-sm text-gray-500">No comments for this operating day.</p>}
        <div className="space-y-3">
          {auditComments.map((comment) => (
            <div key={comment.id} className="border-t pt-3 text-sm">
              <p className="font-medium">{comment.auditorName} · {comment.classification || 'observation'} · {comment.status}</p>
              <p className="whitespace-pre-wrap">{comment.reason}</p>
              <p className="text-xs text-gray-500">{new Date(comment.createdAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
        {canComment && (
          <form onSubmit={submitAuditComment} className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <select value={auditClassification} onChange={(e) => setAuditClassification(e.target.value)} className={inputCls}>
                <option value="observation">Observation</option>
                <option value="concern">Concern</option>
                <option value="issue">Issue</option>
                <option value="recommendation">Recommendation</option>
              </select>
              <button type="submit" disabled={submitting || !auditComment.trim()} className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Save comment</button>
            </div>
            <textarea value={auditComment} onChange={(e) => setAuditComment(e.target.value)} maxLength={2000} required rows={3} className={`${inputCls} w-full`} placeholder="Record your finding for this operating day" />
          </form>
        )}
      </Card>

      {shifts.length === 0 ? (
        <Card><EmptyState title="No shift activity" subtitle="No shift was opened at this branch on this date." /></Card>
      ) : (
        <>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-4">
            {SECTIONS.map((s) => (
              <button
                key={s.key} onClick={() => setSection(s.key)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${section === s.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {section === 'manager' && (
            <div className="space-y-4">
              {shifts.map(({ shift, assignments }) => (
                <Card key={shift.id} className="overflow-hidden">
                  <div className="px-4 py-3 border-b">
                    <p className="font-semibold text-sm">{shift.shiftLabel || 'Full Day'} <span className="text-xs text-gray-400 font-normal">— opened {new Date(shift.openedAt).toLocaleTimeString()}{shift.closedAt ? `, closed ${new Date(shift.closedAt).toLocaleTimeString()}` : ' (still open)'}</span></p>
                  </div>
                  <div className={tableScrollCls}>
                    <table className="w-full text-sm">
                      <thead className={theadCls}>
                        <tr>
                          <th className="px-4 py-2 text-left font-medium">Pump</th>
                          <th className="px-4 py-2 text-left font-medium">Product</th>
                          <th className="px-4 py-2 text-left font-medium">Attendant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {assignments.length === 0 && <EmptyRow colSpan={3} text="No pump assignments" />}
                        {assignments.map((a) => (
                          <tr key={a.id}>
                            <td className="px-4 py-2 font-medium">{a.dispenser.label}</td>
                            <td className="px-4 py-2">{a.dispenser.tank?.product?.name || '—'}</td>
                            <td className="px-4 py-2">{a.attendant.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {section === 'supervisor' && (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Pump Meter Readings</h3></div>
                <div className={tableScrollCls}>
                  <table className="w-full text-sm">
                    <thead className={theadCls}>
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Pump</th>
                        <th className="px-4 py-2 text-right font-medium">Opening</th>
                        <th className="px-4 py-2 text-right font-medium">Closing</th>
                        <th className="px-4 py-2 text-right font-medium">RTT</th>
                        <th className="px-4 py-2 text-right font-medium">Litres</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                        <th className="px-4 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shifts.flatMap((s) => s.readings).length === 0 && <EmptyRow colSpan={7} text="No meter readings" />}
                      {shifts.flatMap((s) => s.readings).map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-2 font-medium">{r.dispenser.label}</td>
                          <td className="px-4 py-2 text-right">{r.opening.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right">{r.closing != null ? r.closing.toLocaleString() : '—'}</td>
                          <td className="px-4 py-2 text-right">{r.rtt.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right font-medium">{r.litres != null ? r.litres.toLocaleString() : '—'}</td>
                          <td className="px-4 py-2">
                            <StatusPill status={r.reviewStatus} color={r.reviewStatus === 'approved' ? 'green' : r.reviewStatus === 'queried' ? 'amber' : 'blue'} />
                            {r.reviewStatus === 'queried' && r.discrepancyNote && <p className="text-xs text-amber-700 mt-0.5">{r.discrepancyNote}</p>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.reviewStatus === 'approved' && <button onClick={() => openCorrectReading(r)} className={tableActionCls}>Correct</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Tank Dips</h3></div>
                {tankDips.length > 0 && <div className="p-4 border-b">
                  <h4 className="font-medium text-sm mb-2">Physical tanks</h4>
                  <div className="grid sm:grid-cols-2 gap-2 text-sm">{tankDips.map((dip) => <p key={dip.id}>
                    {dip.tank.label} · {dip.tank.product.name} · {dip.period}: {dip.measured.toLocaleString()} L
                  </p>)}</div>
                </div>}
                <div className={tableScrollCls}>
                  <table className="w-full text-sm">
                    <thead className={theadCls}>
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Product</th>
                        <th className="px-4 py-2 text-right font-medium">Book</th>
                        <th className="px-4 py-2 text-right font-medium">Measured</th>
                        <th className="px-4 py-2 text-right font-medium">Variance</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {reconciliations.length === 0 && <EmptyRow colSpan={5} text="No dips recorded" />}
                      {reconciliations.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-2 font-medium">{r.product.name}</td>
                          <td className="px-4 py-2 text-right">{r.book.toLocaleString()} L</td>
                          <td className="px-4 py-2 text-right">{r.measured.toLocaleString()} L</td>
                          <td className={`px-4 py-2 text-right ${r.status === 'exception' ? 'text-amber-700 font-medium' : ''}`}>{r.variance > 0 ? '+' : ''}{r.variance.toFixed(1)} L</td>
                          <td className="px-4 py-2"><StatusPill status={r.status === 'exception' ? 'Exception' : 'Within Tolerance'} color={r.status === 'exception' ? 'red' : 'green'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Deliveries</h3></div>
                <div className={tableScrollCls}>
                  <table className="w-full text-sm">
                    <thead className={theadCls}>
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Supplier</th>
                        <th className="px-4 py-2 text-left font-medium">Product</th>
                        <th className="px-4 py-2 text-right font-medium">Quantity</th>
                        <th className="px-4 py-2 text-right font-medium">Cost</th>
                        <th className="px-4 py-2 text-left font-medium">Vehicle</th>
                        <th className="px-4 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {deliveries.length === 0 && <EmptyRow colSpan={6} text="No deliveries" />}
                      {deliveries.map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 py-2 font-medium">{d.supplier?.name || '—'}</td>
                          <td className="px-4 py-2">{d.product.name}</td>
                          <td className="px-4 py-2 text-right">
                            {d.quantity.toLocaleString()} {d.product.unit}
                            {d.offloadVariance != null && Math.abs(d.offloadVariance) > 0.01 && (
                              <span className="block text-xs text-amber-700">{d.offloadVariance > 0 ? '+' : ''}{d.offloadVariance.toFixed(1)}L vs declared</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">{formatMoney(d.totalCost / 100)}</td>
                          <td className="px-4 py-2 text-gray-500">{d.vehicle?.plateNumber || '—'}</td>
                          <td className="px-4 py-2 text-right">
                            {d.qtyRemaining == null && <button onClick={() => openCorrect(d)} className={tableActionCls}>Correct</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {section === 'cashier' && (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Payment Collections</h3></div>
                <div className={tableScrollCls}>
                  <table className="w-full text-sm">
                    <thead className={theadCls}>
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Pump / Attendant</th>
                        <th className="px-4 py-2 text-left font-medium">Handover</th>
                        <th className="px-4 py-2 text-right font-medium">Cash</th>
                        <th className="px-4 py-2 text-right font-medium">POS</th>
                        <th className="px-4 py-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shifts.flatMap((s) => s.collections).length === 0 && <EmptyRow colSpan={5} text="No collections" />}
                      {shifts.flatMap((s) => s.collections).map((collection) => {
                        return (
                          <tr key={collection.id} className={collection.voidedAt ? 'text-gray-400 line-through' : ''}>
                            <td className="px-4 py-2 font-medium">{collection.dispenserLabel} / {collection.attendantName}</td>
                            <td className="px-4 py-2">{collection.collectionType}{collection.voidedAt ? ' (voided)' : ''}</td>
                            <td className="px-4 py-2 text-right">{formatMoney(collection.cashAmount / 100)}</td>
                            <td className="px-4 py-2 text-right">{formatMoney(collection.posAmount / 100)}</td>
                            <td className="px-4 py-2 text-right font-medium">{formatMoney(collection.totalAmount / 100)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Bank Deposits</h3></div>
                <div className={tableScrollCls}>
                  <table className="w-full text-sm">
                    <thead className={theadCls}>
                      <tr>
                        <th className="px-4 py-2 text-right font-medium">Amount</th>
                        <th className="px-4 py-2 text-left font-medium">Bank</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                        <th className="px-4 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shifts.flatMap((s) => s.deposits).length === 0 && <EmptyRow colSpan={4} text="No deposits" />}
                      {shifts.flatMap((s) => s.deposits).map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 py-2 text-right font-semibold">{formatMoney(d.amount / 100)}</td>
                          <td className="px-4 py-2">{d.bankName || '—'}</td>
                          <td className="px-4 py-2"><StatusPill status={d.status} color={d.status === 'approved' ? 'green' : d.status === 'rejected' ? 'red' : 'amber'} /></td>
                          <td className="px-4 py-2 text-right">
                            <button onClick={() => openCorrectDeposit(d)} className={tableActionCls}>Correct</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      <Modal open={!!correctingDelivery} onClose={() => setCorrectingDelivery(null)} title="Correct Delivery">
        <form onSubmit={submitCorrect} className="space-y-4">
          <p className="text-sm text-gray-500">Adjusts the recorded quantity/cost and appends an offsetting stock entry for the difference — the original delivery isn't erased, just corrected.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" required>
              <NumberInput value={correctForm.quantity} onChange={(e) => setCorrectForm({ ...correctForm, quantity: e.target.value })} required />
            </Field>
            <Field label="Cost per unit" required>
              <NumberInput value={correctForm.costPerUnit} onChange={(e) => setCorrectForm({ ...correctForm, costPerUnit: e.target.value })} required />
            </Field>
          </div>
          <Field label="Reason" required>
            <input type="text" value={correctForm.reason} onChange={(e) => setCorrectForm({ ...correctForm, reason: e.target.value })} className={inputCls} required placeholder="Why is this being corrected?" />
          </Field>
          <FormButtons onCancel={() => setCorrectingDelivery(null)} submitting={submitting} submitLabel="Correct Delivery" />
        </form>
      </Modal>

      <Modal open={!!correctingReading} onClose={() => setCorrectingReading(null)} title="Correct Pump Reading">
        <form onSubmit={submitCorrectReading} className="space-y-4">
          <p className="text-sm text-gray-500">Corrects the recorded litres and appends an offsetting stock entry. Collection handovers remain permanent records.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Closing reading" required>
              <NumberInput value={correctReadingForm.closing} onChange={(e) => setCorrectReadingForm({ ...correctReadingForm, closing: e.target.value })} required />
            </Field>
            <Field label="RTT" required>
              <NumberInput value={correctReadingForm.rtt} onChange={(e) => setCorrectReadingForm({ ...correctReadingForm, rtt: e.target.value })} required />
            </Field>
          </div>
          <Field label="Reason" required>
            <input type="text" value={correctReadingForm.reason} onChange={(e) => setCorrectReadingForm({ ...correctReadingForm, reason: e.target.value })} className={inputCls} required placeholder="Why is this being corrected?" />
          </Field>
          <FormButtons onCancel={() => setCorrectingReading(null)} submitting={submitting} submitLabel="Correct Reading" />
        </form>
      </Modal>

      <Modal open={!!correctingDeposit} onClose={() => setCorrectingDeposit(null)} title="Correct Deposit">
        <form onSubmit={submitCorrectDeposit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" required>
              <NumberInput value={correctDepositForm.amount} onChange={(e) => setCorrectDepositForm({ ...correctDepositForm, amount: e.target.value })} required />
            </Field>
            <Field label="Bank name">
              <input type="text" value={correctDepositForm.bankName} onChange={(e) => setCorrectDepositForm({ ...correctDepositForm, bankName: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Account number">
            <input type="text" value={correctDepositForm.accountNumber} onChange={(e) => setCorrectDepositForm({ ...correctDepositForm, accountNumber: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Reason" required>
            <input type="text" value={correctDepositForm.reason} onChange={(e) => setCorrectDepositForm({ ...correctDepositForm, reason: e.target.value })} className={inputCls} required placeholder="Why is this being corrected?" />
          </Field>
          <FormButtons onCancel={() => setCorrectingDeposit(null)} submitting={submitting} submitLabel="Correct Deposit" />
        </form>
      </Modal>
    </div>
  );
}
