'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Card, Field, inputCls, btnPrimaryCls } from '@/components/ui';

// Owner-only (app/admin/settings gates the whole page already; this card doesn't re-check). Two-step
// flow deliberately: resolve the account name from Paystack FIRST so the owner sees who they're about
// to start collecting for, then a separate Enable action actually creates/updates the Paystack
// Subaccount — never skip straight from a typed account number to money flowing through it.
export default function PaymentCollectionCard() {
  const [data, setData] = useState(null);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/settings/payments');
    const d = await r.json();
    if (d.success) {
      setData(d.data);
      setBankCode(d.data.payoutBankCode || '');
      setAccountNumber(d.data.payoutAccountNumber || '');
      setResolvedName(d.data.payoutAccountName || '');
    } else toast.error(d.error || 'Failed to load');
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleVerify = async () => {
    if (!bankCode || !accountNumber) return toast.error('Pick a bank and enter the account number');
    setResolving(true);
    setResolvedName('');
    try {
      const r = await fetch('/api/admin/settings/payments/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bankCode, accountNumber }),
      });
      const d = await r.json();
      if (d.success) { setResolvedName(d.data.accountName); toast.success('Account verified'); } else toast.error(d.error);
    } finally {
      setResolving(false);
    }
  };

  const handleEnable = async () => {
    const bank = data.banks.find((b) => b.code === bankCode);
    if (!bank || !resolvedName) return toast.error('Verify the account first');
    setSaving(true);
    try {
      const r = await fetch('/api/admin/settings/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankCode, bankName: bank.name, accountNumber, accountName: resolvedName }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Payment collection enabled'); load(); } else toast.error(d.error);
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm('Stop collecting customer payments through Cazone? You can re-enable it later.')) return;
    const r = await fetch('/api/admin/settings/payments', { method: 'DELETE' });
    const d = await r.json();
    if (d.success) { toast.success('Payment collection disabled'); load(); } else toast.error(d.error);
  };

  if (!data) return null;

  return (
    <Card className="p-5 mb-6">
      <h3 className="font-semibold text-sm mb-1">Payment Collection</h3>
      <p className="text-xs text-gray-500 mb-4">
        Let customers pay you directly through Cazone — online, at Shop checkout or against their account balance.
        Cazone takes a {data.feePercent}% fee per payment; the rest settles straight to your bank account.
      </p>

      {data.paymentsEnabled ? (
        <div className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
            <p className="font-medium text-green-800">Payment collection is active</p>
            <p className="text-green-700 text-xs mt-1">{data.payoutBankName} — {data.payoutAccountNumber} ({data.payoutAccountName})</p>
          </div>
          <button onClick={handleDisable} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50 text-red-600">
            Disable Payment Collection
          </button>
        </div>
      ) : (
        <div className="space-y-3 max-w-sm">
          <Field label="Bank">
            <select value={bankCode} onChange={(e) => { setBankCode(e.target.value); setResolvedName(''); }} className={inputCls}>
              <option value="">Choose a bank...</option>
              {data.banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Account number">
            <input
              type="text"
              inputMode="numeric"
              value={accountNumber}
              onChange={(e) => { setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); setResolvedName(''); }}
              placeholder="10-digit NUBAN"
              className={inputCls}
            />
          </Field>
          {resolvedName ? (
            <p className="text-sm text-green-700">Verified: <span className="font-medium">{resolvedName}</span></p>
          ) : (
            <button onClick={handleVerify} disabled={resolving} className="px-3 py-1.5 border rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
              {resolving ? 'Verifying...' : 'Verify Account'}
            </button>
          )}
          {resolvedName && (
            <button onClick={handleEnable} disabled={saving} className={`${btnPrimaryCls} w-full`}>
              {saving ? 'Enabling...' : 'Enable Payment Collection'}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
