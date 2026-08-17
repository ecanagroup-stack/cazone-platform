'use client';

import { useRouter } from 'next/navigation';
import PaystackButton from './PaystackButton';

// One-time payment for a single quoted ProvisioningRequest — see BillingSubscription.js for why this
// needs to be its own client component rather than an inline callback from the (server) Billing page.
export default function ProvisioningPayButton({ requestId }) {
  const router = useRouter();
  return (
    <PaystackButton
      prepareUrl={`/api/admin/provisioning-requests/${requestId}/pay`}
      metadata={{ type: 'provisioning', requestId }}
      label="Pay Now"
      className="text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
      onPaid={() => router.refresh()}
    />
  );
}
