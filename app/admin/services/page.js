'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, Modal, FormButtons, Field, inputCls, btnPrimaryCls, tableActionCls, StatusPill } from '@/components/ui';
import { SERVICE_TYPES, serviceLabel } from '@/lib/services';

export default function ServicesPage() {
  const [services, setServices] = useState(null);
  const [enableModal, setEnableModal] = useState(null); // { type, label }
  const [branchName, setBranchName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addBranchFor, setAddBranchFor] = useState(null); // service object
  const [newBranch, setNewBranch] = useState({ name: '', address: '' });

  const load = async () => {
    const r = await fetch('/api/admin/services');
    const d = await r.json();
    if (d.success) setServices(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const handleEnable = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/services', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: enableModal.type, branchName }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${enableModal.label} enabled`); setEnableModal(null); setBranchName(''); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddBranch = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/branches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: addBranchFor.id, ...newBranch }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Branch added'); setAddBranchFor(null); setNewBranch({ name: '', address: '' }); load(); }
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

  if (!services) return <Loader />;

  const enabledTypes = services.map((s) => s.type);
  const available = SERVICE_TYPES.filter((s) => !enabledTypes.includes(s.id));

  return (
    <div>
      <PageHeader title="Services & Branches" subtitle="What your organization runs, and where" />

      <div className="space-y-6 mb-8">
        {services.length === 0 && (
          <Card className="p-6 text-center text-sm text-gray-500">No services enabled yet — add one below.</Card>
        )}
        {services.map((s) => (
          <Card key={s.id} className="overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{s.name || serviceLabel(s.type)}</p>
                <p className="text-xs text-gray-500">{s.branches.length} branch{s.branches.length === 1 ? '' : 'es'}</p>
              </div>
              <button
                onClick={() => { setAddBranchFor(s); setNewBranch({ name: '', address: '' }); }}
                className={tableActionCls}
              >
                + Add Branch
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
          <h3 className="font-semibold text-sm mb-1">Add another service</h3>
          <p className="text-xs text-gray-500 mb-4">Each service gets its own set of branches, managed independently.</p>
          <div className="flex flex-wrap gap-3">
            {available.map((s) => (
              <button
                key={s.id}
                onClick={() => { setEnableModal(s); setBranchName(''); }}
                className="px-4 py-3 border rounded-lg text-sm font-medium hover:border-brand-500 hover:bg-brand-50 text-left"
              >
                {s.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Modal open={!!enableModal} onClose={() => setEnableModal(null)} title={`Enable ${enableModal?.label || ''}`}>
        <form onSubmit={handleEnable} className="space-y-4">
          <p className="text-sm text-gray-500">Name the first branch for this service — you can add more any time.</p>
          <Field label="Branch name" required>
            <input type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)} className={inputCls} required autoFocus placeholder="e.g., Main Branch" />
          </Field>
          <FormButtons onCancel={() => setEnableModal(null)} submitting={submitting} submitLabel="Enable Service" />
        </form>
      </Modal>

      <Modal open={!!addBranchFor} onClose={() => setAddBranchFor(null)} title={`Add branch to ${addBranchFor?.name || addBranchFor ? serviceLabel(addBranchFor?.type) : ''}`}>
        <form onSubmit={handleAddBranch} className="space-y-4">
          <Field label="Branch name" required>
            <input type="text" value={newBranch.name} onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <Field label="Address">
            <input type="text" value={newBranch.address} onChange={(e) => setNewBranch({ ...newBranch, address: e.target.value })} className={inputCls} />
          </Field>
          <FormButtons onCancel={() => setAddBranchFor(null)} submitting={submitting} submitLabel="Add Branch" />
        </form>
      </Modal>
    </div>
  );
}
