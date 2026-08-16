'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Field, inputCls, FormButtons, PasswordInput, UsernameField } from '@/components/ui';
import PlatformLogo from '@/components/shell/PlatformLogo';

const CURRENCIES = ['NGN', 'USD', 'GBP'];

const blankForm = {
  orgName: '', currency: 'NGN', serviceType: '', branchName: '',
  ownerName: '', ownerUsername: '', ownerPassword: '',
};

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [catalog, setCatalog] = useState(null);

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((d) => {
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
      const r = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!d.success) {
        toast.error(d.error || 'Something went wrong');
        setSubmitting(false);
        return;
      }
      const res = await signIn('credentials', {
        emailOrUsername: form.ownerUsername,
        password: form.ownerPassword,
        redirect: false,
      });
      if (res?.error) {
        toast.error('Account created — please sign in');
        router.push('/login');
        return;
      }
      toast.success('Welcome to Cazone');
      router.push('/admin');
      router.refresh();
    } catch (err) {
      toast.error(err.message || 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <PlatformLogo className="h-12 w-12 mb-2" />
          <h1 className="text-xl font-bold text-gray-900">Create your Cazone account</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            You can add more services and branches once you're in.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 space-y-4">
          <Field label="Business name" required>
            <input type="text" required value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} className={inputCls} placeholder="e.g., Ecana Energy" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starting service" required>
              <select value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className={inputCls} disabled={!catalog}>
                {(catalog || []).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Currency" required>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="First branch name" required>
            <input type="text" required value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })} className={inputCls} placeholder="e.g., Jikwoyi" />
          </Field>
          <div className="border-t pt-4 space-y-4">
            <p className="text-sm font-medium">Your login</p>
            <Field label="Your name" required>
              <input type="text" required value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <UsernameField label="Username" required value={form.ownerUsername} onChange={(v) => setForm({ ...form, ownerUsername: v })} />
              <Field label="Password" required>
                <PasswordInput required minLength={8} value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} />
              </Field>
            </div>
          </div>
          <button type="submit" disabled={submitting} className="w-full px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
            {submitting ? 'Creating your account...' : 'Create account'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          Already have an account? <a href="/login" className="text-brand-600 hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  );
}
