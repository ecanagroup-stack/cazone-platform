'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui';
import PaystackButton from './PaystackButton';

// Client wrapper around the Billing page's Paystack actions — kept separate from
// app/admin/billing/page.js (a server component) since a callback prop can't cross that boundary
// directly. router.refresh() re-fetches the page's server data once the webhook has plausibly landed,
// so the Status/Paid-through cards catch up without a full reload.
export default function BillingSubscription({ organizationId, hasSubscription }) {
  const router = useRouter();
  const [canceling, setCanceling] = useState(false);

  const handleCancel = async () => {
    if (!confirm('Cancel the recurring subscription? This stops future automatic charges — access continues until the current paid period ends.')) return;
    setCanceling(true);
    try {
      const r = await fetch('/api/admin/billing/cancel-subscription', { method: 'POST' });
      const d = await r.json();
      if (d.success) { toast.success(d.message); router.refresh(); }
      else toast.error(d.error);
    } finally {
      setCanceling(false);
    }
  };

  return (
    <Card className="p-5 mb-6">
      <h3 className="font-semibold text-sm mb-1">Pay by card (recurring)</h3>
      <p className="text-xs text-gray-500 mb-4">
        Enter your card once — it's charged automatically each month for as long as the subscription is active.
      </p>
      <div className="flex items-center gap-3">
        <PaystackButton
          prepareUrl="/api/admin/billing/subscribe"
          metadata={{ organizationId }}
          label={hasSubscription ? 'Update Card / Resubscribe' : 'Subscribe with Card'}
          onPaid={() => router.refresh()}
        />
        {hasSubscription && (
          <button onClick={handleCancel} disabled={canceling} className="text-sm font-medium text-red-700 hover:text-red-800 disabled:opacity-50">
            {canceling ? 'Canceling...' : 'Cancel Subscription'}
          </button>
        )}
      </div>
    </Card>
  );
}
