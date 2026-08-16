'use client';

import { useState } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { inputCls, PasswordInput } from '@/components/ui';
import PlatformLogo from '@/components/shell/PlatformLogo';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ emailOrUsername: '', password: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const res = await signIn('credentials', { ...form, redirect: false });
    if (res?.error) {
      setSubmitting(false);
      toast.error(res.error);
      return;
    }
    const session = await getSession();
    setSubmitting(false);
    const role = session?.user?.role;
    // middleware.js only allows STAFF_ROLES (owner/manager/staff) into /admin — a super_admin
    // pushed there gets bounced straight back here, which looks like login silently did nothing.
    const destination = role === 'super_admin' ? '/platform/organizations' : role === 'customer' ? '/portal' : '/admin';
    router.push(destination);
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <PlatformLogo className="h-12 w-12 mb-2" />
          <h1 className="text-xl font-bold text-gray-900">Cazone GS&amp;M</h1>
        </div>
        <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email, username or phone</label>
            <input
              type="text"
              required
              value={form.emailOrUsername}
              onChange={(e) => setForm({ ...form, emailOrUsername: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <PasswordInput
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <button type="submit" disabled={submitting} className="w-full px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          New business?{' '}
          <a href="/signup" className="text-brand-600 hover:underline">Create an account</a>
        </p>
      </div>
    </div>
  );
}
