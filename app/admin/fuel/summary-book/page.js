'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, EmptyState, inputCls, theadCls, tableScrollCls, ReportToolbar } from '@/components/ui';
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
export default function SummaryBookPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';

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

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Summary Book" subtitle="Shift-by-shift, product-by-product reconciliation" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page." /></Card>
      </div>
    );
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
                  {rows.map((r, i) => (
                    <tr key={i} className={r.shortage > 0 ? 'bg-amber-50' : ''}>
                      <td className="px-4 py-3 text-gray-500">{formatDate(r.date)}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
