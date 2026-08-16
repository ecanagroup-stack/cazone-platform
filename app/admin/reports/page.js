'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, EmptyState, Tabs, StatusPill,
  inputCls, theadCls, tableScrollCls, ReportToolbar,
} from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const TABS = [
  { key: 'sales', label: 'Sales Summary' },
  { key: 'stock', label: 'Stock Summary' },
  { key: 'cash', label: 'Cash Summary' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';
  const activeTab = ['stock', 'cash'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'sales';

  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());

  const setTab = (key) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === 'sales') params.delete('tab'); else params.set('tab', key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div>
      <PageHeader title="Reports" subtitle="Sales, stock and cash over a date range" />

      {!branchId ? (
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to see its reports." /></Card>
      ) : (
        <>
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

          <Tabs tabs={TABS} active={activeTab} onChange={setTab} />

          {activeTab === 'sales' && <SalesSummary branchId={branchId} from={from} to={to} />}
          {activeTab === 'stock' && <StockSummary branchId={branchId} from={from} to={to} />}
          {activeTab === 'cash' && <CashSummary branchId={branchId} from={from} to={to} />}
        </>
      )}
    </div>
  );
}

function SalesSummary({ branchId, from, to }) {
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reports/sales?branchId=${branchId}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setRows(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return <Loader />;

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-gray-500">Total: <span className="font-semibold text-gray-900">{formatMoney(grandTotal / 100)}</span></p>
        <ReportToolbar
          title="Sales Summary"
          csvFilename="sales-summary"
          csvRows={rows}
          csvColumns={[
            { key: 'date', label: 'Date' },
            { key: 'paymentMethod', label: 'Payment Method' },
            { key: 'channel', label: 'Channel' },
            { key: 'count', label: 'Orders' },
            { key: 'total', label: 'Total', value: (r) => (r.total / 100).toFixed(2) },
          ]}
        />
      </div>
      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Payment Method</th>
                <th className="px-4 py-3 text-left font-medium">Channel</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && <EmptyRow colSpan={5} text="No sales in this range" />}
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.date)}</td>
                  <td className="px-4 py-3 capitalize">{r.paymentMethod}</td>
                  <td className="px-4 py-3 capitalize text-gray-500">{r.channel}</td>
                  <td className="px-4 py-3 text-right">{r.count}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(r.total / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StockSummary({ branchId, from, to }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reports/stock?branchId=${branchId}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <Loader />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <ReportToolbar
          title="Stock Summary"
          csvFilename="stock-summary"
          csvRows={data.rows}
          csvColumns={[
            { key: 'product', label: 'Product' },
            { key: 'reason', label: 'Reason' },
            { key: 'qty', label: 'Quantity' },
          ]}
        />
      </div>
      <Card className="overflow-hidden mb-6">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Product</th>
                <th className="px-4 py-3 text-left font-medium">Reason</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.length === 0 && <EmptyRow colSpan={3} text="No stock movement in this range" />}
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 font-medium">{r.product}</td>
                  <td className="px-4 py-3 capitalize text-gray-500">{r.reason}</td>
                  <td className={`px-4 py-3 text-right ${r.qty < 0 ? 'text-red-600' : ''}`}>{r.qty.toLocaleString()} {r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.variance.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Reconciliation Variance</h3></div>
          <div className={tableScrollCls}>
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Product</th>
                  <th className="px-4 py-3 text-left font-medium">Period End</th>
                  <th className="px-4 py-3 text-right font-medium">Book</th>
                  <th className="px-4 py-3 text-right font-medium">Measured</th>
                  <th className="px-4 py-3 text-right font-medium">Variance</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.variance.map((v, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-medium">{v.product}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(v.periodEnd)}</td>
                    <td className="px-4 py-3 text-right">{v.book.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{v.measured.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right ${v.variance !== 0 ? 'text-amber-700' : ''}`}>{v.variance.toLocaleString()} ({v.variancePct.toFixed(1)}%)</td>
                    <td className="px-4 py-3"><StatusPill status={v.status} color={v.status === 'within_tolerance' ? 'green' : v.status === 'exception' ? 'red' : 'amber'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function CashSummary({ branchId, from, to }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reports/cash?branchId=${branchId}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <Loader />;

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-sm">Shift Cash-Ups</h3>
        <ReportToolbar
          title="Cash Summary — Shifts"
          csvFilename="cash-summary-shifts"
          csvRows={data.shifts}
          csvColumns={[
            { key: 'closedAt', label: 'Closed', value: (r) => formatDate(r.closedAt) },
            { key: 'openingFloat', label: 'Opening Float', value: (r) => (r.openingFloat / 100).toFixed(2) },
            { key: 'expectedCash', label: 'Expected', value: (r) => (r.expectedCash != null ? (r.expectedCash / 100).toFixed(2) : '') },
            { key: 'countedCash', label: 'Counted', value: (r) => (r.countedCash != null ? (r.countedCash / 100).toFixed(2) : '') },
            { key: 'difference', label: 'Difference', value: (r) => (r.difference != null ? (r.difference / 100).toFixed(2) : '') },
          ]}
        />
      </div>
      <Card className="overflow-hidden mb-6">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Closed</th>
                <th className="px-4 py-3 text-right font-medium">Opening Float</th>
                <th className="px-4 py-3 text-right font-medium">Expected</th>
                <th className="px-4 py-3 text-right font-medium">Counted</th>
                <th className="px-4 py-3 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.shifts.length === 0 && <EmptyRow colSpan={5} text="No closed shifts in this range" />}
              {data.shifts.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(s.closedAt)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(s.openingFloat / 100)}</td>
                  <td className="px-4 py-3 text-right">{s.expectedCash != null ? formatMoney(s.expectedCash / 100) : '—'}</td>
                  <td className="px-4 py-3 text-right">{s.countedCash != null ? formatMoney(s.countedCash / 100) : '—'}</td>
                  <td className={`px-4 py-3 text-right ${s.difference ? 'text-amber-700' : ''}`}>{s.difference != null ? formatMoney(s.difference / 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-sm">Deposits</h3>
        <ReportToolbar
          title="Cash Summary — Deposits"
          csvFilename="cash-summary-deposits"
          csvRows={data.deposits}
          csvColumns={[
            { key: 'createdAt', label: 'Date', value: (r) => formatDate(r.createdAt) },
            { key: 'amount', label: 'Amount', value: (r) => (r.amount / 100).toFixed(2) },
            { key: 'bankName', label: 'Bank' },
            { key: 'status', label: 'Status' },
          ]}
        />
      </div>
      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Bank</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.deposits.length === 0 && <EmptyRow colSpan={4} text="No deposits in this range" />}
              {data.deposits.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(d.createdAt)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(d.amount / 100)}</td>
                  <td className="px-4 py-3">{d.bankName}</td>
                  <td className="px-4 py-3"><StatusPill status={d.status} color={d.status === 'approved' ? 'green' : d.status === 'rejected' ? 'red' : 'amber'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
