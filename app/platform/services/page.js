'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls } from '@/components/ui';
import { formatMoney } from '@/lib/format';

const STATUS_COLOR = { available: 'green', coming_soon: 'amber', retired: 'gray' };
const STATUS_LABEL = { available: 'Available', coming_soon: 'Coming soon', retired: 'Retired' };
const blankForm = { key: '', name: '', description: '', status: 'coming_soon', sortOrder: 0, basePriceMonthly: 0 };

// The subscribe/availability catalog — organizations pick from `available` rows at signup and from
// "Add another service" in /admin/services. Building the actual pack (schema + screens) for a new
// row is separate engineering; this only controls whether it's offered.
export default function PlatformServicesPage() {
  const [catalog, setCatalog] = useState(null);
  const [modal, setModal] = useState(null); // 'add' | entry object being edited
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const r = await fetch('/api/platform/services');
    const d = await r.json();
    if (d.success) setCatalog(d.data);
    else toast.error(d.error || 'Failed to load');
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(blankForm); setModal('add'); };
  const openEdit = (s) => { setForm({ key: s.key, name: s.name, description: s.description || '', status: s.status, sortOrder: s.sortOrder, basePriceMonthly: s.basePriceMonthly }); setModal(s); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const isAdd = modal === 'add';
      const r = await fetch(isAdd ? '/api/platform/services' : `/api/platform/services/${modal.key}`, {
        method: isAdd ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) { toast.success(isAdd ? 'Service added' : 'Service updated'); setModal(null); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!catalog) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Service Catalog"
        subtitle="What organizations can subscribe to — add a row here, no deploy needed"
        action={<button onClick={openAdd} className={btnPrimaryCls}>Add Service</button>}
      />

      <Card className="overflow-hidden">
        <div className={tableScrollCls}>
          <table className="w-full text-sm min-w-[700px]">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Key</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Sort</th>
                <th className="px-4 py-3 text-right font-medium">Base price/mo</th>
                <th className="px-4 py-3 text-right font-medium">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {catalog.map((s) => (
                <tr key={s.key} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.key}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-500">{s.description}</p>}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={STATUS_LABEL[s.status]} color={STATUS_COLOR[s.status]} /></td>
                  <td className="px-4 py-3 text-right">{s.sortOrder}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(s.basePriceMonthly)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(s)} className={tableActionCls}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add Service' : `Edit ${modal?.name || ''}`}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {modal === 'add' && (
            <Field label="Key" required>
              <input type="text" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className={inputCls} required placeholder="e.g. warehousing" pattern="[a-z][a-z0-9_]*" />
            </Field>
          )}
          <Field label="Name" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder="e.g. Warehousing & Distribution" />
          </Field>
          <Field label="Description">
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Status" required>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                <option value="coming_soon">Coming soon</option>
                <option value="available">Available</option>
                <option value="retired">Retired</option>
              </select>
            </Field>
            <Field label="Sort order">
              <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Base price/mo">
              <input type="number" value={form.basePriceMonthly} onChange={(e) => setForm({ ...form, basePriceMonthly: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <FormButtons onCancel={() => setModal(null)} submitting={submitting} submitLabel={modal === 'add' ? 'Add Service' : 'Save'} />
        </form>
      </Modal>
    </div>
  );
}
