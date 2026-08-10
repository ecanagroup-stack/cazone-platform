'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls } from '@/components/ui';
import { formatMoney } from '@/lib/format';

const blankForm = { name: '', phone: '', email: '', businessName: '', creditLimit: '' };

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/admin/customers');
    const d = await r.json();
    if (d.success) setCustomers(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, creditLimit: Math.round(Number(form.creditLimit || 0) * 100) }),
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
        subtitle="Accounts that can buy on credit, across any branch or service"
        action={<button onClick={() => { setForm(blankForm); setShowModal(true); }} className={btnPrimaryCls}>Add Customer</button>}
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
                <th className="px-4 py-3 text-right font-medium">Credit Limit</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customers.length === 0 && <EmptyRow colSpan={5} text="No customers yet" />}
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/admin/customers/${c.id}`)}>
                  <td className="px-4 py-3 font-medium">{c.name}{c.businessName && <span className="text-xs text-gray-400 font-normal"> — {c.businessName}</span>}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(c.balance / 100)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{formatMoney(c.creditLimit / 100)}</td>
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
            <Field label="Name" required>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required autoFocus />
            </Field>
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
            <input type="number" step="0.01" min="0" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} className={inputCls} placeholder="0 for cash-only" />
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Customer" />
        </form>
      </Modal>
    </div>
  );
}
