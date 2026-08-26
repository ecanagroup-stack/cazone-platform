'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Card, Field, NumberInput } from '@/components/ui';
import PaystackButton from '@/components/billing/PaystackButton';

// Shown on /portal only when the org has payment collection enabled (see app/portal/page.js) — a
// customer types how much of their balance to pay off (not forced to pay it all at once, matching
// the staff-side Record Payment form's own free-amount behavior) and pays by card via Paystack,
// split straight to the org's own bank account.
export default function PortalPayBalanceButton() {
  const { data: authSession } = useSession();
  const [amount, setAmount] = useState('');

  const amountKobo = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(amountKobo) && amountKobo > 0;

  return (
    <Card className="p-4 mt-4">
      <h3 className="font-semibold text-sm mb-3">Make a Payment</h3>
      <div className="flex items-end gap-3">
        <Field label="Amount">
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-40" />
        </Field>
        <PaystackButton
          prepareUrl="/api/portal/pay/balance"
          prepareBody={{ amount: amountKobo }}
          metadata={{ type: 'balance_payment', customerId: authSession?.user?.customerId, organizationId: authSession?.user?.organizationId }}
          label="Pay Now"
          disabled={!valid}
          onPaid={() => window.location.reload()}
        />
      </div>
    </Card>
  );
}
