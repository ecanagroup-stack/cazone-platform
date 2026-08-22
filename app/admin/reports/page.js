'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, Tabs, StatusPill,
  inputCls, theadCls, tableScrollCls, ReportToolbar,
} from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const TABS = [
  { key: 'sales', label: 'Sales Summary' },
  { key: 'stock', label: 'Stock Summary' },
  { key: 'cash', label: 'Cash Summary' },
  { key: 'balances', label: 'Balances' },
];
const MATERIALS_TAB = { key: 'materials', label: 'Materials' };

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
  const serviceId = searchParams.get('service') || '';

  const [services, setServices] = useState(null);
  useEffect(() => { fetch('/api/admin/services').then((r) => r.json()).then((d) => { if (d.success) setServices(d.data); }); }, []);
  const currentServiceType = services?.find((s) => s.id === serviceId)?.type || null;
  const tabs = currentServiceType === 'shop' ? [...TABS, MATERIALS_TAB] : TABS;

  const activeTab = tabs.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'sales';

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

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        {serviceId && !branchId && <p className="text-xs text-gray-500 pb-2">Showing all branches for this service.</p>}
        {!serviceId && !branchId && <p className="text-xs text-gray-500 pb-2">Showing every business — pick one from the switcher above for its own branch-level detail.</p>}
      </div>

      <Tabs tabs={tabs} active={activeTab} onChange={setTab} />

      {activeTab === 'balances' ? (
        // Customer is an org-level account, not branch/service-scoped (prisma/schema.prisma) — this
        // tab always shows the whole org's book regardless of the branch/service switcher above.
        <BalancesSummary from={from} to={to} />
      ) : !branchId && !serviceId ? (
        <AllBusinessesSummary tab={activeTab} from={from} to={to} />
      ) : (
        <>
          {activeTab === 'sales' && <SalesSummary branchId={branchId} serviceId={serviceId} from={from} to={to} />}
          {activeTab === 'stock' && <StockSummary branchId={branchId} serviceId={serviceId} from={from} to={to} />}
          {activeTab === 'cash' && <CashSummary branchId={branchId} serviceId={serviceId} from={from} to={to} />}
          {activeTab === 'materials' && <MaterialsSummary branchId={branchId} serviceId={serviceId} from={from} to={to} />}
        </>
      )}
    </div>
  );
}

function BalancesSummary({ from, to }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all'); // all | owing | credit

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reports/balances?from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setData(d.data); else toast.error(d.error || 'Failed to load');
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <Loader />;
  const { customers, totals, monthly } = data;
  const rows = customers.filter((c) => filter === 'owing' ? c.balance > 0 : filter === 'credit' ? c.balance < 0 : true);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4"><p className="text-xs text-gray-500">Total Owed to You</p><p className="text-xl font-bold mt-1">{formatMoney(totals.totalOwed / 100)}</p><p className="text-xs text-gray-500 mt-1">{totals.owingCount} customers</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Total Credit in Hand</p><p className="text-xl font-bold mt-1">{formatMoney(totals.totalCredit / 100)}</p><p className="text-xs text-gray-500 mt-1">{totals.creditCount} customers</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Net</p><p className={`text-xl font-bold mt-1 ${totals.net > 0 ? 'text-red-600' : ''}`}>{formatMoney(totals.net / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Zero Balance</p><p className="text-xl font-bold mt-1">{totals.zeroCount}</p></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-sm">Customer Balances</h3>
          <div className="flex gap-2">
            {[['all', 'All'], ['owing', 'Owing'], ['credit', 'In Credit']].map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} className={`px-3 py-1 rounded text-xs font-medium ${filter === key ? 'bg-brand-600 text-white' : 'border hover:bg-gray-50'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Customer</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
                <th className="px-4 py-3 text-right font-medium">Credit Limit</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && <EmptyRow colSpan={4} text="No customers in this view" />}
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/admin/customers/${c.id}`)}>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className={`px-4 py-3 text-right font-medium ${c.balance > 0 ? 'text-red-600' : c.balance < 0 ? 'text-green-600' : ''}`}>{formatMoney(c.balance / 100)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.creditLimit === null ? 'Unlimited' : formatMoney(c.creditLimit / 100)}</td>
                  <td className="px-4 py-3">{c.onHold ? <StatusPill status="On Hold" color="red" /> : <StatusPill status="Active" color="green" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Monthly Activity (debt added vs payments received, in range)</h3></div>
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Month</th>
                <th className="px-4 py-3 text-right font-medium">Debt Added</th>
                <th className="px-4 py-3 text-right font-medium">Payments Received</th>
                <th className="px-4 py-3 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {monthly.length === 0 && <EmptyRow colSpan={4} text="No activity in this period" />}
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td className="px-4 py-3">{m.month}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(m.debtAdded / 100)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(m.paymentsReceived / 100)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${m.net > 0 ? 'text-red-600' : ''}`}>{formatMoney(m.net / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SalesSummary({ branchId, serviceId, from, to }) {
  const [rows, setRows] = useState(null);
  const [allBranches, setAllBranches] = useState(false);

  const load = useCallback(async () => {
    const scope = branchId ? `branchId=${branchId}` : `serviceId=${serviceId}`;
    const r = await fetch(`/api/admin/reports/sales?${scope}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) { setRows(d.data); setAllBranches(d.allBranches); }
    else toast.error(d.error || 'Failed to load');
  }, [branchId, serviceId, from, to]);

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
            ...(allBranches ? [{ key: 'branch', label: 'Branch' }] : []),
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
                {allBranches && <th className="px-4 py-3 text-left font-medium">Branch</th>}
                <th className="px-4 py-3 text-left font-medium">Payment Method</th>
                <th className="px-4 py-3 text-left font-medium">Channel</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && <EmptyRow colSpan={allBranches ? 6 : 5} text="No sales in this range" />}
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.date)}</td>
                  {allBranches && <td className="px-4 py-3">{r.branch}</td>}
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

function StockSummary({ branchId, serviceId, from, to }) {
  const [data, setData] = useState(null);
  const [allBranches, setAllBranches] = useState(false);

  const load = useCallback(async () => {
    const scope = branchId ? `branchId=${branchId}` : `serviceId=${serviceId}`;
    const r = await fetch(`/api/admin/reports/stock?${scope}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) { setData(d.data); setAllBranches(d.allBranches); }
    else toast.error(d.error || 'Failed to load');
  }, [branchId, serviceId, from, to]);

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
            ...(allBranches ? [{ key: 'branch', label: 'Branch' }] : []),
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
                {allBranches && <th className="px-4 py-3 text-left font-medium">Branch</th>}
                <th className="px-4 py-3 text-left font-medium">Product</th>
                <th className="px-4 py-3 text-left font-medium">Reason</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.length === 0 && <EmptyRow colSpan={allBranches ? 4 : 3} text="No stock movement in this range" />}
              {data.rows.map((r, i) => (
                <tr key={i}>
                  {allBranches && <td className="px-4 py-3">{r.branch}</td>}
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
                  {allBranches && <th className="px-4 py-3 text-left font-medium">Branch</th>}
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
                    {allBranches && <td className="px-4 py-3">{v.branch}</td>}
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

function CashSummary({ branchId, serviceId, from, to }) {
  const [data, setData] = useState(null);
  const [allBranches, setAllBranches] = useState(false);

  const load = useCallback(async () => {
    const scope = branchId ? `branchId=${branchId}` : `serviceId=${serviceId}`;
    const r = await fetch(`/api/admin/reports/cash?${scope}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) { setData(d.data); setAllBranches(d.allBranches); }
    else toast.error(d.error || 'Failed to load');
  }, [branchId, serviceId, from, to]);

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
            ...(allBranches ? [{ key: 'branch', label: 'Branch' }] : []),
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
                {allBranches && <th className="px-4 py-3 text-left font-medium">Branch</th>}
                <th className="px-4 py-3 text-left font-medium">Closed</th>
                <th className="px-4 py-3 text-right font-medium">Opening Float</th>
                <th className="px-4 py-3 text-right font-medium">Expected</th>
                <th className="px-4 py-3 text-right font-medium">Counted</th>
                <th className="px-4 py-3 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.shifts.length === 0 && <EmptyRow colSpan={allBranches ? 6 : 5} text="No closed shifts in this range" />}
              {data.shifts.map((s) => (
                <tr key={s.id}>
                  {allBranches && <td className="px-4 py-3">{s.branch}</td>}
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
            ...(allBranches ? [{ key: 'branch', label: 'Branch' }] : []),
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
                {allBranches && <th className="px-4 py-3 text-left font-medium">Branch</th>}
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Bank</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.deposits.length === 0 && <EmptyRow colSpan={allBranches ? 5 : 4} text="No deposits in this range" />}
              {data.deposits.map((d) => (
                <tr key={d.id}>
                  {allBranches && <td className="px-4 py-3">{d.branch}</td>}
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

// M6 — Construction Material only (the Materials tab only shows when the selected service is
// 'shop'). Ported from ecana_shop-app's reports/products + reports/trucks + reports/quarry-purchases,
// combined into one sub-tab set rather than three separate pages.
function MaterialsSummary({ branchId, serviceId, from, to }) {
  const [sub, setSub] = useState('products');
  const scope = branchId ? `branchId=${branchId}` : `serviceId=${serviceId}`;

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {[['products', 'Sales Per Product'], ['trucks', 'Truck Utilization'], ['quarry', 'Quarry Purchases']].map(([key, label]) => (
          <button
            key={key} onClick={() => setSub(key)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${sub === key ? 'bg-brand-600 text-white' : 'border hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === 'products' && <ProductsReport scope={scope} from={from} to={to} />}
      {sub === 'trucks' && <TrucksReport scope={scope} from={from} to={to} />}
      {sub === 'quarry' && <QuarryPurchasesReport scope={scope} from={from} to={to} />}
    </div>
  );
}

function ProductsReport({ scope, from, to }) {
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reports/materials?type=products&${scope}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setRows(d.data); else toast.error(d.error || 'Failed to load');
  }, [scope, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return <Loader />;
  const groups = [['cement', 'Cement Brands'], ['aggregate', 'Aggregate / Quarry Products'], ['shop', 'Cement Warehouse (Shop)']];

  return (
    <div className="space-y-6">
      {groups.map(([key, label]) => {
        const group = rows.filter((r) => r.category === key);
        if (group.length === 0) return null;
        return (
          <Card key={key} className="overflow-hidden">
            <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">{label}</h3></div>
            <div className={tableScrollCls}>
              <table className="w-full text-sm">
                <thead className={theadCls}>
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Product</th>
                    <th className="px-4 py-3 text-right font-medium">Sold (Billed)</th>
                    <th className="px-4 py-3 text-right font-medium">Loaded (Actual)</th>
                    <th className="px-4 py-3 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {group.map((r) => (
                    <tr key={r.productId}>
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 text-right">{r.billQty.toLocaleString()} {r.unit}</td>
                      <td className="px-4 py-3 text-right">{r.actualQty.toLocaleString()} {r.unit}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatMoney(r.revenue / 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
      {rows.length === 0 && <Card><EmptyRow colSpan={4} text="No sales in this range" /></Card>}
    </div>
  );
}

function TrucksReport({ scope, from, to }) {
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reports/materials?type=trucks&${scope}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setRows(d.data); else toast.error(d.error || 'Failed to load');
  }, [scope, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return <Loader />;

  return (
    <Card className="overflow-hidden">
      <div className={tableScrollCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-4 py-3 text-left font-medium">Truck</th>
              <th className="px-4 py-3 text-left font-medium">Driver</th>
              <th className="px-4 py-3 text-right font-medium">Trips</th>
              <th className="px-4 py-3 text-right font-medium">Total Delivery Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && <EmptyRow colSpan={4} text="No truck activity in this range" />}
            {rows.map((r) => (
              <tr key={r.plateNumber}>
                <td className="px-4 py-3 font-medium">{r.plateNumber}</td>
                <td className="px-4 py-3 text-gray-500">{r.driverName}</td>
                <td className="px-4 py-3 text-right">{r.trips}</td>
                <td className="px-4 py-3 text-right font-medium">{formatMoney(r.totalCost / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function QuarryPurchasesReport({ scope, from, to }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reports/materials?type=quarry-purchases&${scope}&from=${from}&to=${to}`);
    const d = await r.json();
    if (d.success) setData(d); else toast.error(d.error || 'Failed to load');
  }, [scope, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <Loader />;

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <p className="text-xs text-gray-500">Total Quantity Purchased</p>
          <p className="text-xl font-bold mt-1">{data.totals.quantity.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Total Cost</p>
          <p className="text-xl font-bold mt-1">{formatMoney(data.totals.cost / 100)}</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Quarry</th>
                <th className="px-4 py-3 text-left font-medium">Product</th>
                <th className="px-4 py-3 text-left font-medium">Truck</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
                <th className="px-4 py-3 text-right font-medium">Cost / Unit</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.data.length === 0 && <EmptyRow colSpan={7} text="No quarry purchases in this range" />}
              {data.data.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.date)}</td>
                  <td className="px-4 py-3">{r.quarryName}</td>
                  <td className="px-4 py-3">{r.product}</td>
                  <td className="px-4 py-3 text-gray-500">{r.truckPlate}</td>
                  <td className="px-4 py-3 text-right">{r.quantity.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(r.costPerUnit / 100)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(r.totalCost / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// "All Businesses" — shown when the switcher is on "All services" (no ?service=/?branch= at all).
// One headline card per enabled service, calling the same already-branch-rolled-up report endpoints
// once each, plus a combined total where that's a meaningful single number (Sales' revenue). Stock
// and Cash don't collapse to one comparable number across different businesses as cleanly, so their
// cards show the headline that actually matters per business instead of forcing a fake combined sum.
function AllBusinessesSummary({ tab, from, to }) {
  const router = useRouter();
  const [services, setServices] = useState(null);
  const [totals, setTotals] = useState({});

  useEffect(() => {
    let cancelled = false;
    setTotals({});
    (async () => {
      const sr = await fetch('/api/admin/services').then((r) => r.json());
      if (!sr.success || cancelled) return;
      const activeServices = sr.data.filter((s) => s.isActive);
      setServices(activeServices);

      const endpoint = tab === 'sales' ? 'sales' : tab === 'stock' ? 'stock' : 'cash';
      const entries = await Promise.all(activeServices.map(async (s) => {
        const r = await fetch(`/api/admin/reports/${endpoint}?serviceId=${s.id}&from=${from}&to=${to}`).then((res) => res.json());
        if (!r.success) return [s.id, null];
        if (tab === 'sales') {
          return [s.id, { total: r.data.reduce((sum, row) => sum + row.total, 0), count: r.data.reduce((sum, row) => sum + row.count, 0) }];
        }
        if (tab === 'stock') {
          return [s.id, { moves: r.data.rows.length, exceptions: r.data.variance.filter((v) => v.status === 'exception').length }];
        }
        return [s.id, {
          shifts: r.data.shifts.length,
          diffTotal: r.data.shifts.reduce((sum, sh) => sum + (sh.difference || 0), 0),
          depositTotal: r.data.deposits.reduce((sum, d) => sum + d.amount, 0),
        }];
      }));
      if (!cancelled) setTotals(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [tab, from, to]);

  if (!services) return <Loader />;
  if (services.length === 0) return <Card><p className="p-6 text-center text-sm text-gray-500">No services enabled yet.</p></Card>;

  const grandTotal = tab === 'sales' ? Object.values(totals).reduce((sum, t) => sum + (t?.total || 0), 0) : null;

  return (
    <div>
      {grandTotal != null && (
        <p className="text-sm text-gray-500 mb-3">Combined total: <span className="font-semibold text-gray-900">{formatMoney(grandTotal / 100)}</span></p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((s) => {
          const t = totals[s.id];
          return (
            <Card
              key={s.id} className="p-4 cursor-pointer hover:border-brand-400"
              onClick={() => router.push(`/admin/reports?service=${s.id}${tab !== 'sales' ? `&tab=${tab}` : ''}`)}
            >
              <p className="text-sm font-semibold">{s.name || s.type}</p>
              {!t ? (
                <p className="text-xs text-gray-400 mt-2">Loading...</p>
              ) : tab === 'sales' ? (
                <>
                  <p className="text-2xl font-bold mt-1">{formatMoney(t.total / 100)}</p>
                  <p className="text-xs text-gray-500 mt-1">{t.count} order{t.count === 1 ? '' : 's'}</p>
                </>
              ) : tab === 'stock' ? (
                <>
                  <p className="text-2xl font-bold mt-1">{t.moves} move{t.moves === 1 ? '' : 's'}</p>
                  {t.exceptions > 0 && <p className="text-xs text-amber-700 mt-1">{t.exceptions} variance exception{t.exceptions === 1 ? '' : 's'}</p>}
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold mt-1">{formatMoney(t.depositTotal / 100)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {t.shifts} shift{t.shifts === 1 ? '' : 's'} closed{t.diffTotal ? `, ${formatMoney(t.diffTotal / 100)} diff` : ''}
                  </p>
                </>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
