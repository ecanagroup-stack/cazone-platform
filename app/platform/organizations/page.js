'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, PasswordInput, OrgLogo, UsernameField } from '@/components/ui';
import { formatDate } from '@/lib/format';

const CURRENCIES = ['NGN', 'USD', 'GBP'];
const statusColor = { trialing: 'blue', active: 'green', past_due: 'amber', canceled: 'gray' };

const blankForm = {
  orgName: '', phone: '', email: '', currency: 'NGN', serviceType: '', branchName: '',
  ownerName: '', ownerUsername: '', ownerPassword: '',
};

export default function PlatformOrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const catalogLabel = (key) => catalog.find((s) => s.key === key)?.name || key;

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/platform/organizations');
    const d = await r.json();
    if (d.success) setOrgs(d.data);
    else toast.error(d.error || 'Failed to load');
    setLoading(false);
  };

  useEffect(() => {
    load();
    fetch('/api/catalog').then((r) => r.json()).then((d) => {
      if (d.success) {
        setCatalog(d.data);
        if (d.data.length > 0) setForm((f) => ({ ...f, serviceType: d.data[0].key }));
      }
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/platform/organizations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) { toast.success('Organization created'); setShowModal(false); setForm(blankForm); load(); }
      else toast.error(d.error);
    } catch (err) {
      toast.error(err.message || 'Something went wrong, please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const totalBranches = orgs.reduce((s, o) => s + (o.branchCount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Every business using the platform"
        action={<button onClick={() => { setForm(blankForm); setShowModal(true); }} className={btnPrimaryCls}>Add Organization</button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-4"><p className="text-xs text-gray-500">Organizations</p><p className="text-2xl font-bold mt-1">{orgs.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Paying / Trialing</p><p className="text-2xl font-bold mt-1">{orgs.filter((o) => o.subscriptionStatus === 'active' || o.freeForever).length} / {orgs.filter((o) => o.subscriptionStatus === 'trialing' && !o.freeForever).length}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Total Branches</p><p className="text-2xl font-bold mt-1">{totalBranches}</p></Card>
      </div>

      {loading ? <Loader /> : (
        <Card className="overflow-hidden">
          <div className={tableScrollCls}>
            <table className="w-full text-sm min-w-[900px]">
              <thead className={theadCls}>
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Organization</th>
                  <th className="px-4 py-3 text-left font-medium">Services</th>
                  <th className="px-4 py-3 text-left font-medium">Plan</th>
                  <th className="px-4 py-3 text-right font-medium">Staff</th>
                  <th className="px-4 py-3 text-right font-medium">Branches</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orgs.length === 0 && <EmptyRow colSpan={6} text="No organizations yet" />}
                {orgs.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/platform/organizations/${o.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <OrgLogo org={o} dim="h-8 w-8" />
                        <div>
                          <Link href={`/platform/organizations/${o.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{o.name}</Link>
                          <p className="text-xs text-gray-500">{o.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{o.serviceTypes.map((t) => catalogLabel(t)).join(', ') || '—'}</td>
                    <td className="px-4 py-3">
                      {!o.isActive
                        ? <StatusPill status="Suspended" color="red" />
                        : o.freeForever
                        ? <StatusPill status="Free forever" color="green" />
                        : <StatusPill status={o.subscriptionStatus} color={statusColor[o.subscriptionStatus] || 'gray'} />}
                      {o.isActive && !o.freeForever && o.subscriptionStatus === 'trialing' && o.trialEndsAt && (
                        <p className="text-xs text-gray-500 mt-1">trial ends {formatDate(o.trialEndsAt)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{o.staffCount}</td>
                    <td className="px-4 py-3 text-right">{o.branchCount}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Organization">
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">Creates a brand-new, isolated business workspace with its own owner login and a 14-day trial.</p>
          <Field label="Business name" required>
            <input type="text" value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} className={inputCls} required placeholder="e.g., Test Fuel Stop" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone number">
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Company email">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starting service" required>
              <select value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className={inputCls}>
                {catalog.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Currency" required>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="First branch name" required>
            <input type="text" value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })} className={inputCls} required placeholder="e.g., Main Branch" />
          </Field>
          <div className="border-t pt-4 space-y-4">
            <p className="text-sm font-medium">First owner login</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner name" required>
                <input type="text" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className={inputCls} required />
              </Field>
              <UsernameField label="Username" required value={form.ownerUsername} onChange={(v) => setForm({ ...form, ownerUsername: v })} />
            </div>
            <Field label="Password" required>
              <PasswordInput value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} required minLength={8} />
            </Field>
          </div>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Create Organization" />
        </form>
      </Modal>
    </div>
  );
}
