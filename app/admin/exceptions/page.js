'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, Modal, FormButtons, Field, inputCls, StatusPill } from '@/components/ui';
import { formatDate } from '@/lib/format';

const SEVERITY_COLOR = { info: 'blue', concern: 'amber', issue: 'red' };
const TARGET_LABEL = { Shift: 'Cash-up', Order: 'Sale', Reconciliation: 'Stock variance' };

export default function ExceptionsPage() {
  const [flags, setFlags] = useState(null);
  const [ackFor, setAckFor] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/exceptions');
    const d = await r.json();
    if (d.success) setFlags(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const handleAcknowledge = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/exceptions/${ackFor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Acknowledged'); setAckFor(null); setNote(''); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!flags) return <Loader />;

  return (
    <div>
      <PageHeader title="Anything Wrong" subtitle="Credit overrides, cash-up differences, and stock variances that need a look" />

      {flags.length === 0 ? (
        <Card><EmptyState title="Nothing open" subtitle="Every flag raised across your branches has been acknowledged." /></Card>
      ) : (
        <div className="space-y-3">
          {flags.map((f) => (
            <Card key={f.id} className="p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <StatusPill status={TARGET_LABEL[f.targetType] || f.targetType} color={SEVERITY_COLOR[f.severity] || 'gray'} />
                  {f.branchName && <span className="text-xs text-gray-400">{f.branchName}</span>}
                  <span className="text-xs text-gray-400">{formatDate(f.createdAt)}</span>
                </div>
                <p className="text-sm whitespace-pre-line">{f.reason}</p>
              </div>
              <button
                onClick={() => { setAckFor(f); setNote(''); }}
                className="shrink-0 px-3 py-1.5 border rounded text-sm font-medium hover:bg-gray-50"
              >
                Acknowledge
              </button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!ackFor} onClose={() => setAckFor(null)} title="Acknowledge">
        <form onSubmit={handleAcknowledge} className="space-y-4">
          <p className="text-sm text-gray-500">{ackFor?.reason}</p>
          <Field label="Note" required>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} rows={3} required autoFocus placeholder="What did you check, and what's the resolution?" />
          </Field>
          <FormButtons onCancel={() => setAckFor(null)} submitting={submitting} submitLabel="Acknowledge" />
        </form>
      </Modal>
    </div>
  );
}
