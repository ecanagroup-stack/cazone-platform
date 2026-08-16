'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls, PasswordInput, NumberInput, OrgLogo } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const statusColor = { trialing: 'blue', active: 'green', past_due: 'amber', canceled: 'gray' };
const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };

export default function OrganizationDetailPage() {
  const { id } = useParams();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [extendPlan, setExtendPlan] = useState('monthly');
  const [extending, setExtending] = useState(false);
  const [requests, setRequests] = useState(null);
  const [quotingFor, setQuotingFor] = useState(null); // request
  const [quoteAmount, setQuoteAmount] = useState('');
  const [decidingFor, setDecidingFor] = useState(null); // { request, action }
  const [decisionNote, setDecisionNote] = useState('');
  const [deciding, setDeciding] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/platform/organizations/${id}`);
    const d = await r.json();
    if (d.success) {
      setOrg(d.data);
      setForm({
        name: d.data.name,
        phone: d.data.phone || '',
        email: d.data.email || '',
        currency: d.data.currency,
        subscriptionStatus: d.data.subscriptionStatus,
        trialEndsAt: d.data.trialEndsAt ? d.data.trialEndsAt.split('T')[0] : '',
        freeForever: d.data.freeForever,
        monthlyPrice: d.data.monthlyPrice || 0,
      });
    } else toast.error(d.error || 'Failed to load');
    setLoading(false);
  };

  const loadRequests = async () => {
    const r = await fetch(`/api/platform/organizations/${id}/provisioning-requests`);
    const d = await r.json();
    if (d.success) setRequests(d.data);
  };

  useEffect(() => { load(); loadRequests(); }, [id]);

  const submitQuote = async (e) => {
    e.preventDefault();
    setDeciding(true);
    try {
      const r = await fetch(`/api/platform/organizations/${id}/provisioning-requests/${quotingFor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quote', quotedAmount: Number(quoteAmount) }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Quote sent'); setQuotingFor(null); setQuoteAmount(''); loadRequests(); }
      else toast.error(d.error);
    } finally {
      setDeciding(false);
    }
  };

  const submitDecision = async (e) => {
    e.preventDefault();
    setDeciding(true);
    try {
      const r = await fetch(`/api/platform/organizations/${id}/provisioning-requests/${decidingFor.request.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decidingFor.action, decisionNote }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success(decidingFor.action === 'approve' ? 'Approved and provisioned' : 'Rejected');
        setDecidingFor(null); setDecisionNote(''); loadRequests(); load();
      } else toast.error(d.error);
    } finally {
      setDeciding(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch(`/api/platform/organizations/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, trialEndsAt: form.trialEndsAt || null }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Saved'); load(); }
      else toast.error(d.error);
    } catch (err) {
      toast.error(err.message || 'Something went wrong, please try again');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    const goingActive = !org.isActive;
    if (!confirm(goingActive ? `Reactivate ${org.name}? Staff will be able to log in again.` : `Suspend ${org.name}? Staff will not be able to log in until reactivated.`)) return;
    setTogglingActive(true);
    try {
      const r = await fetch(`/api/platform/organizations/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: goingActive }),
      });
      const d = await r.json();
      if (d.success) { toast.success(goingActive ? 'Reactivated' : 'Suspended'); load(); }
      else toast.error(d.error);
    } finally {
      setTogglingActive(false);
    }
  };

  const handleExtend = async () => {
    const label = extendPlan === 'monthly' ? '1 month' : '1 year';
    if (!confirm(`Extend ${org.name}'s subscription by ${label}?`)) return;
    setExtending(true);
    try {
      const r = await fetch(`/api/platform/organizations/${id}/extend-subscription`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: extendPlan }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`Extended by ${label}`); load(); }
      else toast.error(d.error);
    } finally {
      setExtending(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) return toast.error('Password must be at least 8 characters');
    setResetting(true);
    try {
      const r = await fetch(`/api/platform/organizations/${id}/users/${resetTarget.id}/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`Password reset for ${resetTarget.name}`); setResetTarget(null); setNewPassword(''); }
      else toast.error(d.error);
    } finally {
      setResetting(false);
    }
  };

  if (loading || !org || !form) return <Loader />;

  const branchCount = org.services.reduce((sum, s) => sum + s.branches.length, 0);

  return (
    <div>
      <Link href="/platform/organizations" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <FiArrowLeft size={14} /> All Organizations
      </Link>

      <div className="flex items-center gap-4">
        <OrgLogo org={org} dim="h-12 w-12" />
        <div className="flex-1">
          <PageHeader
            title={org.name}
            subtitle={org.slug}
            action={
              <button
                onClick={toggleActive}
                disabled={togglingActive}
                className={`px-4 py-2 rounded text-sm font-medium border disabled:opacity-50 ${org.isActive ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-green-300 text-green-700 hover:bg-green-50'}`}
              >
                {org.isActive ? 'Suspend Organization' : 'Reactivate Organization'}
              </button>
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-xs text-gray-500">Status</p>
          <div className="mt-1">
            {org.isActive
              ? (org.freeForever ? <StatusPill status="Free forever" color="green" /> : <StatusPill status={org.subscriptionStatus} color={statusColor[org.subscriptionStatus] || 'gray'} />)
              : <StatusPill status="Suspended" color="red" />}
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">{org.subscriptionEndsAt ? 'Paid through' : 'Trial ends'}</p>
          <p className="text-lg font-bold mt-1">{org.freeForever ? '—' : formatDate(org.subscriptionEndsAt || org.trialEndsAt)}</p>
        </Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Services</p><p className="text-2xl font-bold mt-1">{org.services.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Branches</p><p className="text-2xl font-bold mt-1">{branchCount}</p></Card>
      </div>

      {!org.freeForever && (
        <Card className="p-5 mb-6">
          <h3 className="font-semibold text-sm mb-4">Extend Subscription</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Plan">
              <select value={extendPlan} onChange={(e) => setExtendPlan(e.target.value)} className={inputCls}>
                <option value="monthly">Monthly ({formatMoney(org.monthlyPrice, org.currency)})</option>
                <option value="yearly">Yearly ({formatMoney(org.monthlyPrice * 12, org.currency)})</option>
              </select>
            </Field>
            <button onClick={handleExtend} disabled={extending} className={btnPrimaryCls}>
              {extending ? 'Extending...' : 'Extend Now'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-3">Use this when a subscriber has paid you outside Paystack (bank transfer, cash, etc). It extends from whichever is later — today, or their current paid-through date.</p>
        </Card>
      )}

      <Card className="p-5 mb-6">
        <h3 className="font-semibold text-sm mb-4">Organization Settings</h3>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Business name" required>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required />
            </Field>
            <Field label="Currency">
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls}>
                {['NGN', 'USD', 'GBP'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Phone number">
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Company email">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Subscription status">
              <select
                value={form.subscriptionStatus}
                onChange={(e) => setForm({ ...form, subscriptionStatus: e.target.value })}
                className={inputCls}
                disabled={form.freeForever}
              >
                <option value="trialing">Trialing</option>
                <option value="active">Active</option>
                <option value="past_due">Past Due</option>
                <option value="canceled">Canceled</option>
              </select>
            </Field>
            <Field label="Monthly price">
              <NumberInput value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 items-end">
            <Field label="Trial ends">
              <input type="date" value={form.trialEndsAt} onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })} className={inputCls} disabled={form.freeForever} />
            </Field>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={form.freeForever} onChange={(e) => setForm({ ...form, freeForever: e.target.checked })} />
              Free forever (exempt from trial/billing)
            </label>
          </div>

          <div className="pt-2">
            <button type="submit" disabled={saving} className={btnPrimaryCls}>{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Services &amp; Branches</h3></div>
        <div className="divide-y">
          {org.services.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">No services enabled yet.</p>}
          {org.services.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <p className="text-sm font-medium">{s.name || s.type} <span className="text-xs text-gray-400">({s.branches.length} branch{s.branches.length === 1 ? '' : 'es'})</span></p>
              {s.branches.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">{s.branches.map((b) => b.name).join(', ')}</p>
              )}
            </div>
          ))}
        </div>
        <p className="px-4 py-2 text-xs text-gray-400 border-t bg-gray-50">Branches within an existing service are managed by the org's own owner — new services/branches only exist once approved below.</p>
      </Card>

      <Card className="overflow-hidden mb-6">
        <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Provisioning Requests</h3></div>
        {!requests ? (
          <div className="p-4"><Loader /></div>
        ) : requests.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No requests yet.</p>
        ) : (
          <div className="divide-y">
            {requests.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {r.type === 'service' ? `New business: ${r.serviceType}` : `New branch: ${r.branchName} — ${r.service?.name || r.service?.type}`}
                  </p>
                  {r.note && <p className="text-xs text-gray-500 mt-0.5">{r.note}</p>}
                  {r.quotedAmount != null && <p className="text-xs text-gray-500 mt-0.5">Quoted {formatMoney(r.quotedAmount, org.currency)}</p>}
                  {r.decisionNote && <p className="text-xs text-gray-500 mt-0.5">{r.decisionNote}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill status={r.status} color={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'quoted' ? 'blue' : 'amber'} />
                  {r.status === 'pending' && (
                    <button onClick={() => { setQuotingFor(r); setQuoteAmount(''); }} className={tableActionCls}>Quote</button>
                  )}
                  {['pending', 'quoted'].includes(r.status) && (
                    <>
                      <button onClick={() => { setDecidingFor({ request: r, action: 'approve' }); setDecisionNote(''); }} className={tableActionCls}>Approve &amp; Provision</button>
                      <button onClick={() => { setDecidingFor({ request: r, action: 'reject' }); setDecisionNote(''); }} className="text-sm font-medium text-red-700 hover:text-red-800">Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Staff</h3></div>
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Role</th>
                <th className="px-4 py-3 text-left font-medium">Login</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {org.users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3">{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email || u.username || u.phone || '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={u.isActive ? 'Active' : 'Inactive'} color={u.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setResetTarget(u); setNewPassword(''); }} className={tableActionCls}>Reset Password</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title={`Reset password for ${resetTarget?.name || ''}`}>
        <form onSubmit={handleResetPassword} className="space-y-4">
          <p className="text-sm text-gray-500">Sets a new password directly — use this when a staff member is locked out and their own org owner can't help.</p>
          <Field label="New password" required>
            <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
          </Field>
          <FormButtons onCancel={() => setResetTarget(null)} submitting={resetting} submitLabel="Reset Password" />
        </form>
      </Modal>

      <Modal open={!!quotingFor} onClose={() => setQuotingFor(null)} title="Send a Quote">
        <form onSubmit={submitQuote} className="space-y-4">
          <p className="text-sm text-gray-500">
            {quotingFor?.type === 'service' ? `New business: ${quotingFor?.serviceType}` : `New branch: ${quotingFor?.branchName}`}
          </p>
          <Field label={`Quoted amount (${org.currency})`} required>
            <NumberInput value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} required autoFocus />
          </Field>
          <FormButtons onCancel={() => setQuotingFor(null)} submitting={deciding} submitLabel="Send Quote" />
        </form>
      </Modal>

      <Modal open={!!decidingFor} onClose={() => setDecidingFor(null)} title={decidingFor?.action === 'approve' ? 'Approve & Provision' : 'Reject Request'}>
        <form onSubmit={submitDecision} className="space-y-4">
          <p className="text-sm text-gray-500">
            {decidingFor?.action === 'approve'
              ? 'This creates the service/branch immediately — only do this once payment is confirmed.'
              : 'The org will see this request as rejected.'}
          </p>
          <Field label="Note (optional)">
            <input type="text" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} className={inputCls} />
          </Field>
          <FormButtons onCancel={() => setDecidingFor(null)} submitting={deciding} submitLabel={decidingFor?.action === 'approve' ? 'Approve & Provision' : 'Reject'} />
        </form>
      </Modal>
    </div>
  );
}
