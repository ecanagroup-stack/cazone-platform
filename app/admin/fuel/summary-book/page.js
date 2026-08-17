'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, EmptyState, StatusPill, Modal, FormButtons, Field,
  inputCls, tableActionCls, theadCls, tableScrollCls, ReportToolbar, NumberInput,
} from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
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
                { key: 'openingStock', label: 'Opening Stock' },
                { key: 'stockIn', label: 'Stock In' },
                { key: 'sales', label: 'Sales (L)' },
                { key: 'closingStock', label: 'Closing Stock' },
                { key: 'price', label: 'Price', value: (r) => (r.price / 100).toFixed(2) },
                { key: 'totalAmount', label: 'Revenue', value: (r) => (r.totalAmount / 100).toFixed(2) },
                { key: 'shortage', label: 'Shortage', value: (r) => (r.shortage / 100).toFixed(2) },
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
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.length === 0 && <EmptyRow colSpan={10} text="No shift activity in this range" />}
                  {rows.map((r, i) => {
                    const dateStr = r.date.slice(0, 10);
                    return (
                      <tr key={i} className={`cursor-pointer hover:bg-gray-50 ${r.shortage > 0 ? 'bg-amber-50' : ''}`} onClick={() => openDay(dateStr)}>
                        <td className="px-4 py-3 text-brand-600 hover:underline">{formatDate(r.date)}</td>
                        <td className="px-4 py-3 text-gray-500">{r.shiftLabel || (r.shiftOrder ? `Shift ${r.shiftOrder}` : 'Full Day')}</td>
                        <td className="px-4 py-3 font-medium">{r.product}</td>
                        <td className="px-4 py-3 text-right">{r.openingStock.toLocaleString()} L</td>
                        <td className="px-4 py-3 text-right">{r.stockIn.toLocaleString()} L</td>
                        <td className="px-4 py-3 text-right">{r.sales.toLocaleString()} L</td>
                        <td className="px-4 py-3 text-right">{r.closingStock != null ? `${r.closingStock.toLocaleString()} L` : '—'}</td>
                        <td className="px-4 py-3 text-right">{formatMoney(r.price / 100)}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatMoney(r.totalAmount / 100)}</td>
                        <td className={`px-4 py-3 text-right ${r.shortage > 0 ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>
                          {r.shortage > 0 ? formatMoney(r.shortage / 100) : '—'}
                        </td>
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
  const [data, setData] = useState(null);
  const [section, setSection] = useState('supervisor');
  const [correctingDelivery, setCorrectingDelivery] = useState(null);
  const [correctForm, setCorrectForm] = useState({ quantity: '', costPerUnit: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);

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

  if (!data) return <Loader />;

  const { shifts, deliveries, reconciliations } = data;

  return (
    <div>
      <PageHeader
        title={`Day Detail — ${formatDate(date)}`}
        subtitle={shifts.length === 0 ? 'No shift activity this day' : `${shifts.length} shift${shifts.length === 1 ? '' : 's'}`}
        action={<button onClick={onBack} className="text-sm font-medium text-brand-600 hover:text-brand-700">← Back to Summary Book</button>}
      />

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
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shifts.flatMap((s) => s.readings).length === 0 && <EmptyRow colSpan={6} text="No meter readings" />}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Tank Dips</h3></div>
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
                        <th className="px-4 py-2 text-left font-medium">Pump</th>
                        <th className="px-4 py-2 text-right font-medium">Cash</th>
                        <th className="px-4 py-2 text-right font-medium">POS</th>
                        <th className="px-4 py-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shifts.flatMap((s) => s.readings.filter((r) => r.cashCollected != null)).length === 0 && <EmptyRow colSpan={4} text="No collections" />}
                      {shifts.flatMap((s) => s.readings.filter((r) => r.cashCollected != null)).map((r) => {
                        const pos = r.posPayments.reduce((sum, p) => sum + p.amount, 0);
                        return (
                          <tr key={r.id}>
                            <td className="px-4 py-2 font-medium">{r.dispenser.label}</td>
                            <td className="px-4 py-2 text-right">{formatMoney(r.cashCollected / 100)}</td>
                            <td className="px-4 py-2 text-right">{formatMoney(pos / 100)}</td>
                            <td className="px-4 py-2 text-right font-medium">{formatMoney((r.cashCollected + pos) / 100)}</td>
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
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shifts.flatMap((s) => s.deposits).length === 0 && <EmptyRow colSpan={3} text="No deposits" />}
                      {shifts.flatMap((s) => s.deposits).map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 py-2 text-right font-semibold">{formatMoney(d.amount / 100)}</td>
                          <td className="px-4 py-2">{d.bankName || '—'}</td>
                          <td className="px-4 py-2"><StatusPill status={d.status} color={d.status === 'approved' ? 'green' : d.status === 'rejected' ? 'red' : 'amber'} /></td>
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
    </div>
  );
}
