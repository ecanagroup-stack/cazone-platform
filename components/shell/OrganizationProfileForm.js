'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Card, Field, inputCls, btnPrimaryCls } from '@/components/ui';
import { resizeImageToPng } from '@/lib/imageResize';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// Organization profile + logo upload, ported from ecana_shop-app's app/admin/organization/page.js —
// logo uploads immediately on file select (no separate "save" step for it); the rest of the fields
// save together via the form below.
export default function OrganizationProfileForm({ org }) {
  const [form, setForm] = useState({
    name: org.name || '', phone: org.phone || '', email: org.email || '', address: org.address || '',
    invoiceFooter: org.invoiceFooter || '', bankName: org.bankName || '', accountNumber: org.accountNumber || '', accountName: org.accountName || '',
  });
  const [logoUrl, setLogoUrl] = useState(org.logoUrl || '');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) { toast.error('Logo must be a PNG, JPEG, WEBP, or SVG image'); e.target.value = ''; return; }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      try { body.append('smallFile', await resizeImageToPng(file, 200)); } catch { /* SVG or resize failure — full-size upload still proceeds */ }
      const r = await fetch('/api/admin/organization/logo', { method: 'POST', body });
      const d = await r.json();
      if (d.success) { setLogoUrl(d.data.logoUrl); toast.success('Logo uploaded'); }
      else toast.error(d.error);
    } catch (err) {
      toast.error(err.message || 'Something went wrong, please try again');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/organization', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) toast.success('Organization profile saved');
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 mb-6">
      <h3 className="font-semibold text-sm mb-4">Organization Profile</h3>

      <div className="mb-5 flex items-center gap-4">
        {logoUrl ? (
          <img src={logoUrl} alt="Logo" className="h-16 w-16 rounded object-contain border bg-white" />
        ) : (
          <div className="h-16 w-16 rounded border bg-gray-50 flex items-center justify-center text-xs text-gray-400">No logo</div>
        )}
        <label className="px-3 py-1.5 border rounded text-sm font-medium hover:bg-gray-50 cursor-pointer">
          {uploading ? 'Uploading...' : 'Upload logo'}
          <input type="file" accept={ALLOWED_TYPES.join(',')} onChange={handleLogoUpload} disabled={uploading} className="hidden" />
        </label>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Business name" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required />
          </Field>
          <Field label="Phone">
            <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <Field label="Company email">
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Address">
          <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
        </Field>

        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-3">Invoicing</p>
          <div className="space-y-4">
            <Field label="Invoice footer">
              <input type="text" value={form.invoiceFooter} onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })} className={inputCls} placeholder="Terms, thank-you note, etc." />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Bank name">
                <input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Account number">
                <input type="text" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Account name">
                <input type="text" value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} className={inputCls} />
              </Field>
            </div>
          </div>
        </div>

        <button type="submit" disabled={submitting} className={btnPrimaryCls}>{submitting ? 'Saving...' : 'Save'}</button>
      </form>
    </Card>
  );
}
