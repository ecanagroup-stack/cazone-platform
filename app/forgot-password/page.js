'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { inputCls } from '@/components/ui';
import PlatformLogo from '@/components/shell/PlatformLogo';

// Public — no session. Same shape for a staff login or a customer's portal login, since both are
// just a User row (lib/auth.js) and app/api/auth/forgot-password doesn't distinguish. Always shows
// the same generic confirmation regardless of what was typed or whether it matched anything
// (lib/passwordReset.js's requestPasswordReset is deliberately silent either way).
export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }),
      });
      setSent(true);
    } catch {
      toast.error('Something went wrong — try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <PlatformLogo className="h-12 w-12 mb-2" />
          <h1 className="text-xl font-bold text-gray-900">Cazone GS&amp;M</h1>
        </div>

        <div className="bg-white border rounded-lg p-6">
          {sent ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-gray-700">
                If an account exists for <span className="font-medium">{identifier}</span>, we&apos;ve sent a password reset link to the email on file. It expires in an hour.
              </p>
              <a href="/login" className="block text-sm text-brand-600 hover:underline">Back to sign in</a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600">Enter your email, username or phone and we&apos;ll email a reset link to the address on file.</p>
              <div>
                <label className="block text-sm font-medium mb-1">Email, username or phone</label>
                <input
                  type="text" required autoFocus
                  value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  className={inputCls}
                />
              </div>
              <button type="submit" disabled={submitting} className="w-full px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
                {submitting ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          <a href="/login" className="text-brand-600 hover:underline">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
