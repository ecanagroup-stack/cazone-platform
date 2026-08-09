'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, EmptyState, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls } from '@/components/ui';

const blankForm = { staffNumber: '', name: '', phone: '', position: '', employmentType: 'full_time' };

export default function AttendantsPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch') || '';

  const [attendants, setAttendants] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) { setAttendants(null); return; }
    const r = await fetch(`/api/admin/fuel/attendants?branchId=${branchId}`);
    const d = await r.json();
    if (d.success) setAttendants(d.data);
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/fuel/attendants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, ...form }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowModal(false); setForm(blankForm); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (a) => {
    const goingActive = !a.isActive;
    if (!goingActive && !confirm(`Deactivate ${a.name}? Their history stays, they just can't be assigned to a pump.`)) return;
    const r = await fetch(`/api/admin/fuel/attendants/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: goingActive }),
    });
    const d = await r.json();
    if (d.success) load(); else toast.error(d.error);
  };

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Attendants" subtitle="Staff per branch" />
        <Card><EmptyState title="Pick a branch" subtitle="Choose a branch from the switcher at the top of the page to see and manage its attendants." /></Card>
      </div>
    );
  }

  if (!attendants) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Attendants"
        subtitle="Pump attendants at this branch — not login accounts, just staff records for assignment"
        action={<button onClick={() => { setForm(blankForm); setShowModal(true); }} className={btnPrimaryCls}>Add Attendant</button>}
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Staff #</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Position</th>
                <th className="px-4 py-3 text-left font-medium">Phone</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {attendants.length === 0 && <EmptyRow colSpan={6} text="No attendants yet" />}
              {attendants.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-mono text-xs">{a.staffNumber}</td>
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-gray-500">{a.position || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{a.phone || '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={a.isActive ? 'Active' : 'Inactive'} color={a.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleActive(a)} className={tableActionCls}>{a.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Attendant">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Staff number" required>
              <input type="text" value={form.staffNumber} onChange={(e) => setForm({ ...form, staffNumber: e.target.value })} className={inputCls} required autoFocus />
            </Field>
            <Field label="Name" required>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Position">
              <input type="text" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className={inputCls} placeholder="e.g., Pump Attendant" />
            </Field>
          </div>
          <Field label="Employment type">
            <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })} className={inputCls}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="casual">Casual</option>
            </select>
          </Field>
          <FormButtons onCancel={() => setShowModal(false)} submitting={submitting} submitLabel="Add Attendant" />
        </form>
      </Modal>
    </div>
  );
}
