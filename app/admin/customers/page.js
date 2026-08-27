'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, ReportToolbar, NumberInput, CustomerNameField } from '@/components/ui';
import { formatMoney } from '@/lib/format';

const blankForm = { name: '', phone: '', email: '', businessName: '', creditLimit: '', branchIds: [] };

// Customers are branch/business-bound (see prisma/schema.prisma's CustomerAccess) — registering one
// here always tags at least the branch currently selected in the switcher; the checklist below that
// lets a manager who can see more than one branch deliberately extend access to others too, rather
// than sharing everywhere by default.
export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentBranchId = searchParams.get('branch') || '';

  const [customers, setCustomers] = useState(null);
  const [services, setServices] = useState([]);
  const [accessibleBranchIds, setAccessibleBranchIds] = useState(null); // null = unrestricted
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [nameDuplicate, setNameDuplicate] = useState(null);

  const load = useCallback(async () => {
    const qs = currentBranchId ? `?branchId=${currentBranchId}` : '';
    const [cr, sr, mr] = await Promise.all([fetch(`/api/admin/customers${qs}`), fetch('/api/admin/services'), fetch('/api/admin/me')]);
    const [cd, sd, md] = await Promise.all([cr.json(), sr.json(), mr.json()]);
    if (cd.success) setCustomers(cd.data); else toast.error(cd.error || 'Failed to load');
    if (sd.success) setServices(sd.data);
    if (md.success) setAccessibleBranchIds(md.data.accessibleBranchIds);
  }, [currentBranchId]);

  useEffect(() => { load(); }, [load]);

  const allBranches = services.flatMap((s) => s.branches.map((b) => ({ ...b, serviceName: s.name })))
    .filter((b) => accessibleBranchIds === null || accessibleBranchIds.includes(b.id));

  const openCreate = () => {
    setForm({ ...blankForm, branchIds: currentBranchId ? [currentBranchId] : [] });
    setNameDuplicate(null);
    setShowModal(true);
  };

  const toggleBranch = (branchId) => {
    setForm((f) => ({
      ...f,
      branchIds: f.branchIds.includes(branchId) ? f.branchIds.filter((id) => id !== branchId) : [...f.branchIds, branchId],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.branchIds.length === 0) return toast.error('Pick at least one business/branch to register this customer at');
    if (nameDuplicate) return toast.error(`A customer named "${nameDuplicate.name}" already exists — use a different name, or add something to distinguish this one`);
    setSubmitting(true);
    try {
      const [branchId, ...branchIds] = form.branchIds;
      const r = await fetch('/api/admin/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, branchId, branchIds, creditLimit: form.creditLimit === '' ? null : Math.round(Number(form.creditLimit) * 100) }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowModal(false); setForm(blankForm); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!customers) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={currentBranchId ? 'Accounts registered at the current branch' : 'Every customer across the organization'}
        action={<button onClick={openCreate} className={btnPrimaryCls}>Add Customer</button>}
      />

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b flex justify-end">
          <ReportToolbar
            title="Customers"
            csvFilename="customers"
            csvRows={customers}
            csvColumns={[
              { key: 'name', label: 'Name' },
              { key: 'businessName', label: 'Business Name' },
              { key: 'phone', label: 'Phone' },
              { key: 'balance', label: 'Balance', value: (r) => (r.balance / 100).toFixed(2) },
              { key: 'creditLimit', label: 'Credit Limit', value: (r) => (r.creditLimit === null ? 'Unlimited' : (r.creditLimit / 100).toFixed(2)) },
              { key: 'isActive', label: 'Status', value: (r) => (r.onHold ? 'On Hold' : r.isActive ? 'Active' : 'Inactive') },
            ]}
          />
        </div>
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Businesses</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
                <th className="px-4 py-3 text-right font-medium">Credit Limit</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customers.length === 0 && <EmptyRow colSpan={6} text="No customers yet" />}
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/admin/customers/${c.id}`)}>
                  <td className="px-4 py-3 font-medium">{c.name}{c.businessName && <span className="text-xs text-gray-400 font-normal"> — {c.businessName}</span>}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{(c.access || []).map((a) => a.branch.name).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(c.balance / 100)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.creditLimit === null ? 'Unlimited' : formatMoney(c.creditLimit / 100)}</td>
                  <td className="px-4 py-3">
                    {c.onHold ? <StatusPill status="On Hold" color="red" /> : <StatusPill status={c.isActive ? 'Active' : 'Inactive'} color={c.isActive ? 'green' : 'gray'} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Customer">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <CustomerNameField value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onDuplicateChange={setNameDuplicate} autoFocus />
            <Field label="Phone">
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Business name">
              <input type="text" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Credit limit">
            <NumberInput value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="Leave blank for unlimited, 0 for cash-only" />
          </Field>
          <Field label="Register at" required>
            <div className="flex flex-wrap gap-3 max-h-32 overflow-y-auto border rounded p-2">
              {allBranches.length === 0 && <p className="text-xs text-gray-500">No branches yet</p>}
              {allBranches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                  {b.name} <span className="text-xs text-gray-400">({b.serviceName})</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">Checking more than one shares this customer's data and sellability across those businesses.</p>
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Customer" />
        </form>
      </Modal>
    </div>
  );
}
