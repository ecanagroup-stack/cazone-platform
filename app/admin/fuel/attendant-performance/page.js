'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, inputCls, tableScrollCls } from '@/components/ui';
import { formatMoney } from '@/lib/format';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function shortLabel(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric' });
}

// Ported from petrol-station-app's Staff Performance Heatmap (admin/staff-report) — per-attendant,
// per-day shortage/overage between meter sales and cash+POS actually collected, so an owner can spot
// a pattern across a week rather than only ever seeing one shift's cash-up at a time.
export default function AttendantPerformancePage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';

  const [anchor, setAnchor] = useState(todayIso());
  const [rows, setRows] = useState(null);
  const [byDay, setByDay] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [popup, setPopup] = useState(null);

  const from = weekStart(anchor);
  const to = addDays(from, 6);
  const cols = [];
  for (let c = from; c <= to; c = addDays(c, 1)) cols.push(c);

  const load = useCallback(async () => {
    if (!branchId) return;
    const r = await fetch(`/api/admin/fuel/attendant-performance?branchId=${branchId}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) { setRows(d.data.rows); setByDay(d.data.byDay); }
    else toast.error(d.error || 'Failed to load');
  }, [branchId, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Attendant Performance" subtitle="Meter sales vs. cash collected, by attendant" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page." /></Card>
      </div>
    );
  }

  if (!rows) return <Loader />;

  const dayMap = {};
  for (const d of byDay) {
    dayMap[d.attendantId] = dayMap[d.attendantId] || {};
    dayMap[d.attendantId][d.date] = d;
  }

  const filteredRows = rows
    .filter((r) => !search || r.attendantName.toLowerCase().includes(search.toLowerCase()) || r.attendantStaffNumber.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'shortage') return b.totalShortage - a.totalShortage;
      if (sortBy === 'amount') return b.totalMeterSales - a.totalMeterSales;
      return a.attendantStaffNumber.localeCompare(b.attendantStaffNumber);
    });

  return (
    <div>
      <PageHeader title="Attendant Performance" subtitle="Meter sales vs. cash + POS collected, by attendant" />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={() => setAnchor(addDays(anchor, -7))} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">← Prev week</button>
        <span className="text-sm font-medium">{shortLabel(from)} – {shortLabel(to)}</span>
        <button onClick={() => setAnchor(addDays(anchor, 7))} disabled={to >= todayIso()} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50 disabled:opacity-40">Next week →</button>
        <button onClick={() => setAnchor(todayIso())} className="text-sm text-brand-600 hover:underline font-medium">Today</button>
        <input type="text" placeholder="Search attendant..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-48 ml-auto`} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={inputCls} style={{ width: 'auto' }}>
          <option value="name">Sort: Name</option>
          <option value="shortage">Sort: Total Shortage</option>
          <option value="amount">Sort: Sales Amount</option>
        </select>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap mb-4">
        <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-green-200" /> Worked, no shortage</div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-amber-200" /> Worked, shortage</div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-gray-50 border" /> Not assigned</div>
      </div>

      {filteredRows.length === 0 ? (
        <Card><EmptyState title="No attendant data for this period" subtitle="Assign attendants to pumps to see performance data here." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className={tableScrollCls}>
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase tracking-wide sticky left-0 bg-gray-50 z-10 min-w-[8rem] border-r">Attendant</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-600 uppercase tracking-wide min-w-[3.5rem] border-r">STF#</th>
                  {cols.map((c) => (
                    <th key={c} className="px-1 py-2.5 text-center font-medium text-gray-500 min-w-[2.5rem] border">{shortLabel(c)}</th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-600 uppercase tracking-wide sticky right-0 bg-gray-50 z-10 border-l">Summary</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const dm = dayMap[row.attendantId] || {};
                  return (
                    <tr key={row.attendantId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900 sticky left-0 bg-white z-10 border-r whitespace-nowrap">{row.attendantName}</td>
                      <td className="px-3 py-2 font-mono text-gray-500 border-r whitespace-nowrap">{row.attendantStaffNumber}</td>
                      {cols.map((c) => {
                        const d = dm[c];
                        const isFuture = c > todayIso();
                        return (
                          <td key={c} className="border px-1 py-1 text-center align-middle min-w-[2.5rem]">
                            {isFuture ? (
                              <div className="w-full h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300">—</div>
                            ) : !d ? (
                              <div className="w-full h-8 rounded bg-gray-50 flex items-center justify-center text-gray-300">·</div>
                            ) : (
                              <button
                                onClick={() => setPopup({ attendantName: row.attendantName, day: c, data: d })}
                                className={`w-full h-8 rounded font-medium ${d.shortage > 0 ? 'bg-amber-200 hover:bg-amber-300 text-amber-900' : 'bg-green-200 hover:bg-green-300 text-green-900'}`}
                                title={`${d.pumps.join(', ')} — Shortage: ${formatMoney(d.shortage / 100)}`}
                              >
                                {d.shortage > 0 ? '₦' : '✓'}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right sticky right-0 bg-white z-10 border-l whitespace-nowrap">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-gray-600">{row.daysWorked}d</span>
                          {row.totalShortage > 0 ? (
                            <span className="text-amber-700 font-medium">{formatMoney(row.totalShortage / 100)}</span>
                          ) : row.daysWorked > 0 ? (
                            <span className="text-green-600 font-medium">Clean</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {popup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setPopup(null)} />
          <div className="relative z-10 w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900 mb-1">{popup.attendantName}</h2>
            <p className="text-sm text-gray-500 mb-4">{new Date(`${popup.day}T12:00:00`).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Pump(s)</dt><dd className="font-medium">{popup.data.pumps.join(', ') || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Meter Sales</dt><dd className="font-medium">{formatMoney(popup.data.meterSales / 100)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Collected (Cash + POS)</dt><dd className="font-medium">{formatMoney(popup.data.collected / 100)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Shortage</dt><dd className={`font-semibold ${popup.data.shortage > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{popup.data.shortage > 0 ? formatMoney(popup.data.shortage / 100) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Overage</dt><dd className={`font-semibold ${popup.data.overage > 0 ? 'text-green-700' : 'text-gray-400'}`}>{popup.data.overage > 0 ? formatMoney(popup.data.overage / 100) : '—'}</dd></div>
            </dl>
            <button onClick={() => setPopup(null)} className="mt-5 w-full py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
