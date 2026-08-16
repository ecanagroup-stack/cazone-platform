'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, Modal, FormButtons, Field, inputCls, btnPrimaryCls, tableActionCls, StatusPill } from '@/components/ui';

const REQUEST_STATUS_COLOR = { pending: 'amber', quoted: 'blue', approved: 'green', rejected: 'red' };

// Services and branches are no longer self-service beyond what an org signed up for — a service
// comes with its first branch at a quoted cost, and wanting more (another branch, or a whole new
// business) is a request cazone quotes a price for, same manual pay-then-confirm flow subscription
// renewal already uses (see app/admin/billing/page.js for where the org tracks its own requests).
// The actual creation only happens once a platform operator approves & provisions it — see
// app/api/platform/organizations/[id]/provisioning-requests/[requestId]/route.js.
export default function ServicesPage() {
  const [services, setServices] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [requests, setRequests] = useState(null);
  const [enableModal, setEnableModal] = useState(null); // catalog entry { key, name }
  const [branchName, setBranchName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addBranchFor, setAddBranchFor] = useState(null); // service object
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchNote, setNewBranchNote] = useState('');

  const load = async () => {
    const [sr, rr] = await Promise.all([
      fetch('/api/admin/services').then((r) => r.json()),
      fetch('/api/admin/provisioning-requests').then((r) => r.json()),
    ]);
    if (sr.success) setServices(sr.data); else toast.error(sr.error || 'Failed to load');
    if (rr.success) setRequests(rr.data);
  };

  useEffect(() => {
    load();
    fetch('/api/catalog').then((r) => r.json()).then((d) => { if (d.success) setCatalog(d.data); });
  }, []);

  const handleRequestService = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/provisioning-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'service', serviceType: enableModal.key, branchName, note }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`Request sent — we'll quote ${enableModal.name} shortly`); setEnableModal(null); setBranchName(''); setNote(''); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestBranch = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/provisioning-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'branch', serviceId: addBranchFor.id, branchName: newBranchName, note: newBranchNote }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Request sent — we\'ll quote this branch shortly'); setAddBranchFor(null); setNewBranchName(''); setNewBranchNote(''); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBranch = async (branch) => {
    const r = await fetch(`/api/admin/branches/${branch.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !branch.isActive }),
    });
    const d = await r.json();
    if (d.success) load();
    else toast.error(d.error);
  };

  if (!services || !requests) return <Loader />;

  const enabledTypes = services.map((s) => s.type);
  const pendingTypes = requests.filter((r) => r.type === 'service' && ['pending', 'quoted'].includes(r.status)).map((r) => r.serviceType);
  const available = catalog.filter((s) => !enabledTypes.includes(s.key) && !pendingTypes.includes(s.key));
  const openRequests = requests.filter((r) => ['pending', 'quoted'].includes(r.status));

  return (
    <div>
      <PageHeader title="Services & Branches" subtitle="What your organization runs, and where" />

      {openRequests.length > 0 && (
        <Card className="p-5 mb-6">
          <h3 className="font-semibold text-sm mb-1">Pending requests</h3>
          <p className="text-xs text-gray-500 mb-4">We'll send a quote — pay it the same way you pay your subscription (bank transfer, then let us know), and it's provisioned right after.</p>
          <div className="space-y-2">
            {openRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span>{r.type === 'service' ? `New business: ${catalog.find((c) => c.key === r.serviceType)?.name || r.serviceType}` : `New branch: ${r.branchName} (${r.service?.name || r.service?.type})`}</span>
                <StatusPill status={r.status} color={REQUEST_STATUS_COLOR[r.status]} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-6 mb-8">
        {services.length === 0 && (
          <Card className="p-6 text-center text-sm text-gray-500">No services enabled yet — request one below.</Card>
        )}
        {services.map((s) => (
          <Card key={s.id} className="overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{s.name || s.type}</p>
                <p className="text-xs text-gray-500">{s.branches.length} branch{s.branches.length === 1 ? '' : 'es'}</p>
              </div>
              <button
                onClick={() => { setAddBranchFor(s); setNewBranchName(''); setNewBranchNote(''); }}
                className={tableActionCls}
              >
                Request Branch
              </button>
            </div>
            <div className="divide-y">
              {s.branches.length === 0 && <p className="px-4 py-4 text-sm text-gray-500">No branches yet.</p>}
              {s.branches.map((b) => (
                <div key={b.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{b.name}</p>
                    {b.address && <p className="text-xs text-gray-500">{b.address}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={b.isActive ? 'Active' : 'Inactive'} color={b.isActive ? 'green' : 'gray'} />
                    <button onClick={() => toggleBranch(b)} className={tableActionCls}>
                      {b.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {available.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-1">Request another business</h3>
          <p className="text-xs text-gray-500 mb-4">Each business runs its own set of branches, managed independently. Adding one is a request — we'll quote it before anything is created.</p>
          <div className="flex flex-wrap gap-3">
            {available.map((s) => (
              <button
                key={s.key}
                onClick={() => { setEnableModal(s); setBranchName(''); setNote(''); }}
                className="px-4 py-3 border rounded-lg text-sm font-medium hover:border-brand-500 hover:bg-brand-50 text-left"
              >
                {s.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Modal open={!!enableModal} onClose={() => setEnableModal(null)} title={`Request ${enableModal?.name || ''}`}>
        <form onSubmit={handleRequestService} className="space-y-4">
          <p className="text-sm text-gray-500">Name the first branch for this business — we'll send a quote before it's created.</p>
          <Field label="Branch name" required>
            <input type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)} className={inputCls} required autoFocus placeholder="e.g., Main Branch" />
          </Field>
          <Field label="Note (optional)">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="Anything we should know" />
          </Field>
          <FormButtons onCancel={() => setEnableModal(null)} submitting={submitting} submitLabel="Send Request" />
        </form>
      </Modal>

      <Modal open={!!addBranchFor} onClose={() => setAddBranchFor(null)} title={`Request a branch for ${addBranchFor ? (addBranchFor.name || addBranchFor.type) : ''}`}>
        <form onSubmit={handleRequestBranch} className="space-y-4">
          <Field label="Branch name" required>
            <input type="text" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} className={inputCls} required autoFocus />
          </Field>
          <Field label="Note (optional)">
            <input type="text" value={newBranchNote} onChange={(e) => setNewBranchNote(e.target.value)} className={inputCls} placeholder="Location, why you need it, etc." />
          </Field>
          <FormButtons onCancel={() => setAddBranchFor(null)} submitting={submitting} submitLabel="Send Request" />
        </form>
      </Modal>
    </div>
  );
}
