'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Card, Field, inputCls, btnPrimaryCls } from '@/components/ui';

// Owner-only editor for where verification codes get sent (lib/otp.js) — the first tenant-side
// organization-settings form this platform has. otpPhone is captured for a future SMS channel;
// nothing sends to it yet.
export default function OtpSettingsCard({ org }) {
  const [form, setForm] = useState({ otpEmail: org.otpEmail || '', otpPhone: org.otpPhone || '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/organization', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) toast.success('Settings saved');
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 mb-6">
      <h3 className="font-semibold text-sm mb-1">Security</h3>
      <p className="text-xs text-gray-500 mb-4">
        Where one-time verification codes are sent for high-stakes actions (credit limit overrides, price approvals). Falls back to the organization's main email if left blank.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
        <Field label="OTP email">
          <input type="email" value={form.otpEmail} onChange={(e) => setForm({ ...form, otpEmail: e.target.value })} className={inputCls} placeholder={org.email || 'e.g. owner@yourbusiness.com'} />
        </Field>
        <Field label="OTP phone">
          <input type="text" value={form.otpPhone} onChange={(e) => setForm({ ...form, otpPhone: e.target.value })} className={inputCls} placeholder="For a future SMS option — not used yet" />
        </Field>
        <button type="submit" disabled={submitting} className={btnPrimaryCls}>{submitting ? 'Saving...' : 'Save'}</button>
      </form>
    </Card>
  );
}
