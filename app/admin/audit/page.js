'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import {
  Loader, PageHeader, Card, EmptyRow, inputCls, theadCls, tableScrollCls, ReportToolbar,
} from '@/components/ui';

function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// Ported from petrol-station-app's /admin/audit — the first screen in this repo that actually
// reads the AuditLog table (14 routes write to it, nothing has read it back until now).
export default function AuditLogPage() {
  const { data: authSession } = useSession();
  const role = authSession?.user?.role;

  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ from, to, limit: String(limit), page: String(page) });
    if (entityType) params.set('entityType', entityType);
    if (action) params.set('action', action);
    const r = await fetch(`/api/admin/audit?${params.toString()}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [from, to, entityType, action, limit, page]);

  useEffect(() => { if (role === 'owner') load(); }, [role, load]);

  if (role && role !== 'owner') {
    return (
      <div>
        <PageHeader title="Audit Log" />
        <Card className="p-6 text-center text-sm text-gray-500">Only the organization owner can view the audit log.</Card>
      </div>
    );
  }

  if (!data) return <Loader />;

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Who changed what, and when — every price change, correction, deactivation and override."
        action={
          <ReportToolbar
            title="Audit Log" csvFilename="audit-log" csvRows={data.rows}
            csvColumns={[
              { key: 'createdAt', label: 'When', value: (r) => new Date(r.createdAt).toLocaleString() },
              { key: 'actorName', label: 'Actor' },
              { key: 'action', label: 'Action' },
              { key: 'entityType', label: 'Entity' },
              { key: 'entityId', label: 'Entity ID' },
            ]}
          />
        }
      />

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Entity type</label>
            <input type="text" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className={inputCls} placeholder="e.g. Delivery" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Action contains</label>
            <input type="text" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className={inputCls} placeholder="e.g. corrected" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Per page</label>
            <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className={inputCls}>
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">When</th>
                <th className="px-4 py-3 text-left font-medium">Actor</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.length === 0 && <EmptyRow colSpan={4} text="No audit entries in this range" />}
              {data.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">{r.actorName}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                    <td className="px-4 py-2 text-gray-500">{r.entityType} <span className="text-xs text-gray-400">{r.entityId}</span></td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={4} className="px-4 py-3 bg-gray-50">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-medium text-gray-500 mb-1">Before</p>
                            <pre className="text-xs bg-white border rounded p-2 overflow-auto max-h-64">{r.before ? JSON.stringify(r.before, null, 2) : '—'}</pre>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-500 mb-1">After</p>
                            <pre className="text-xs bg-white border rounded p-2 overflow-auto max-h-64">{r.after ? JSON.stringify(r.after, null, 2) : '—'}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.total > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <p>{data.total} entr{data.total === 1 ? 'y' : 'ies'}</p>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
