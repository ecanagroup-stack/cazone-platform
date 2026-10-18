'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, Modal, FormButtons, Field, inputCls, btnPrimaryCls, tableActionCls, StatusPill } from '@/components/ui';

const REQUEST_STATUS_COLOR = { pending: 'amber', quoted: 'blue', approved: 'green', rejected: 'red' };

// The first service is created immediately so a newly registered organization can start working.
// Additional branches remain quote-based requests handled by the platform provisioning flow.
export default function ServicesPage() {
  const [services, setServices] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [businessType, setBusinessType] = useState('');
  const [addons, setAddons] = useState([]);
  const [requests, setRequests] = useState(null);
  const [enableModal, setEnableModal] = useState(null); // catalog entry { key, name }
  const [branchName, setBranchName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fuelBranchChange, setFuelBranchChange] = useState(null);
  const [fuelBranchReason, setFuelBranchReason] = useState('');

  const load = async () => {
    const [sr, rr] = await Promise.all([
      fetch('/api/admin/services').then((r) => r.json()),
      fetch('/api/admin/provisioning-requests').then((r) => r.json()),
    ]);
    if (sr.success) { setServices(sr.data); setAddons(sr.addons || []); setBusinessType(sr.businessType); } else toast.error(sr.error || 'Failed to load');
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
      const firstService = services.length === 0;
      const r = await fetch(firstService ? '/api/admin/services' : '/api/admin/provisioning-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firstService
          ? { type: enableModal.key, branchName }
          : { type: 'service', serviceType: enableModal.key, branchName, note }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(firstService ? `${enableModal.name} is ready to use` : `Request sent — we'll quote ${enableModal.name} shortly`);
        setEnableModal(null); setBranchName(''); setNote(''); load();
      }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const requestAddon = async (addonType, requiresBranch) => {
    const branchName = requiresBranch ? window.prompt(addonType === 'petrol_station' ? 'Name the additional petrol station' : 'Name the additional shop') : null;
    if (requiresBranch && !branchName?.trim()) return;
    const r = await fetch('/api/admin/provisioning-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'addon', addonType, branchName: branchName?.trim() || '', note: '' }),
    });
    const d = await r.json();
    if (d.success) { toast.success('Add-on request sent for quotation'); load(); }
    else toast.error(d.error || 'Could not request add-on');
  };

  const toggleBranch = async (branch, reason = '') => {
    const r = await fetch(`/api/admin/branches/${branch.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !branch.isActive, editReason: reason }),
    });
    const d = await r.json();
    if (d.success) { setFuelBranchChange(null); setFuelBranchReason(''); load(); }
    else toast.error(d.error);
  };

  if (!services || !requests) return <Loader />;

  const enabledTypes = services.map((s) => s.type);
  const pendingTypes = requests.filter((r) => r.type === 'service' && ['pending', 'quoted'].includes(r.status)).map((r) => r.serviceType);
  const available = catalog.filter((s) => s.key === businessType && !enabledTypes.includes(s.key) && !pendingTypes.includes(s.key));
  const openRequests = requests.filter((r) => ['pending', 'quoted'].includes(r.status));

  return (
    <div>
      <PageHeader title="Services & Branches" subtitle="What your organization runs, and where" />

      {openRequests.length > 0 && (
        <Card className="p-5 mb-6">
          <h3 className="font-semibold text-sm mb-1">Pending requests</h3>
          <p className="text-xs text-gray-500 mb-4">We’ll send a quote for this add-on. It is enabled after payment and approval.</p>
          <div className="space-y-2">
            {openRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span>{r.type === 'service' ? `New business: ${catalog.find((c) => c.key === r.serviceType)?.name || r.serviceType}` : r.type === 'addon' ? `Add-on: ${r.addonType}${r.branchName ? ` — ${r.branchName}` : ''}` : `New branch: ${r.branchName} (${r.service?.name || r.service?.type})`}</span>
                <StatusPill status={r.status} color={REQUEST_STATUS_COLOR[r.status]} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {services.length > 0 && (
        <Card className="p-5 mb-8">
          <h3 className="font-semibold text-sm mb-1">Business add-ons</h3>
          <p className="text-xs text-gray-500 mb-4">
            Your registered business type stays unchanged. Add-ons give you extra locations or petroleum capabilities at an additional cost.
          </p>
          <div className="flex flex-wrap gap-3">
            {businessType === 'shop' && (
              <button onClick={() => requestAddon('shop', true)} className={tableActionCls}>Request additional shop</button>
            )}
            {businessType === 'fuel_station' && (
              <>
                <button onClick={() => requestAddon('petrol_station', true)} className={tableActionCls}>Request additional petrol station</button>
                {!addons.some((a) => a.type === 'distributor') && <button onClick={() => requestAddon('distributor', false)} className={tableActionCls}>Request distributor add-on</button>}
              </>
            )}
          </div>
          {addons.length > 0 && <p className="text-xs text-gray-500 mt-3">Active add-ons: {addons.map((a) => a.type).join(', ')}</p>}
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
                <p className="text-xs text-gray-500">{s.branches.length} branch{s.branches.length === 1 ? '' : 'es'} · Active service</p>
              </div>
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
                    <button onClick={() => s.type === 'fuel_station' ? (setFuelBranchChange(b), setFuelBranchReason('')) : toggleBranch(b)} className={tableActionCls}>
                      {b.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {services.length === 0 && available.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-1">Start your business</h3>
          <p className="text-xs text-gray-500 mb-4">Choose your registered business type and name its first branch. It will be ready immediately.</p>
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

      <Modal open={!!fuelBranchChange} onClose={() => setFuelBranchChange(null)} title={`${fuelBranchChange?.isActive ? 'Deactivate' : 'Reactivate'} ${fuelBranchChange?.name || ''}`}>
        <form onSubmit={(event) => { event.preventDefault(); toggleBranch(fuelBranchChange, fuelBranchReason.trim()); }} className="space-y-4">
          <Field label="Reason for change" required>
            <input className={inputCls} value={fuelBranchReason} onChange={(event) => setFuelBranchReason(event.target.value)} required minLength={5} autoFocus />
          </Field>
          <FormButtons onCancel={() => setFuelBranchChange(null)} submitting={false} submitLabel="Save Change" />
        </form>
      </Modal>

      <Modal open={!!enableModal} onClose={() => setEnableModal(null)} title={`${services.length === 0 ? 'Start' : 'Request'} ${enableModal?.name || ''}`}>
        <form onSubmit={handleRequestService} className="space-y-4">
          <p className="text-sm text-gray-500">{services.length === 0 ? 'Name the first branch for this business. The service will be created immediately.' : 'Name the branch — we will send a quote before it is created.'}</p>
          <Field label="Branch name" required>
            <input type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)} className={inputCls} required autoFocus placeholder="e.g., Main Branch" />
          </Field>
          <Field label="Note (optional)">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="Anything we should know" />
          </Field>
          <FormButtons onCancel={() => setEnableModal(null)} submitting={submitting} submitLabel={services.length === 0 ? 'Start Business' : 'Send Request'} />
        </form>
      </Modal>

    </div>
  );
}
