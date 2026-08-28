'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { PasswordInput } from '@/components/ui';
import PlatformLogo from '@/components/shell/PlatformLogo';

// Public — landing page for the link app/api/auth/forgot-password emailed. The token in the URL IS
// the credential here (lib/passwordReset.js's resetPasswordWithToken checks it directly), not a
// session; works for a staff or customer account alike since both are just a User row.
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) return toast.error('Password must be at least 8 characters');
    if (newPassword !== confirm) return toast.error('Passwords do not match');
    setSubmitting(true);
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success('Password reset — sign in with your new password');
        setDone(true);
        setTimeout(() => router.push('/login'), 1500);
      } else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="bg-white border rounded-lg p-6 text-center space-y-3">
        <p className="text-sm text-gray-700">This reset link is missing its token — copy the full link from your email, or request a new one.</p>
        <a href="/forgot-password" className="block text-sm text-brand-600 hover:underline">Request a new link</a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-white border rounded-lg p-6 text-center">
        <p className="text-sm text-gray-700">Password reset. Redirecting you to sign in&hellip;</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">New password</label>
        <PasswordInput required minLength={8} autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Confirm new password</label>
        <PasswordInput required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <button type="submit" disabled={submitting} className="w-full px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
        {submitting ? 'Saving...' : 'Reset password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <PlatformLogo className="h-12 w-12 mb-2" />
          <h1 className="text-xl font-bold text-gray-900">Cazone GS&amp;M</h1>
        </div>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
        <p className="text-center text-sm text-gray-500 mt-4">
          <a href="/login" className="text-brand-600 hover:underline">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
