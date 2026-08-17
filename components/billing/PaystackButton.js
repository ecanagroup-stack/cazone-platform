'use client';

import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { btnPrimaryCls } from '@/components/ui';

// Loaded once, shared by every PaystackButton on a page — Paystack's own script, not an npm package
// (their API is plain REST, and Inline/Popup checkout is only shipped as this script tag).
let scriptPromise = null;
function loadPaystackScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.PaystackPop) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v1/inline.js';
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

// `prepareUrl` is a POST route that ensures whatever Paystack needs already exists server-side
// (customer/plan for a subscription, a reference for a one-time charge) and returns
// { reference, amountKobo, email, planCode? } — this component never talks to Paystack's REST API
// directly, only the popup script. The onSuccess callback here is purely optimistic UI: the ONLY
// thing that ever actually marks a payment as applied is the webhook (app/api/webhooks/paystack),
// so this just tells the user to expect a short delay and refreshes once it's done.
export default function PaystackButton({ prepareUrl, metadata, label, className, onPaid }) {
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const handleClick = async () => {
    setLoading(true);
    try {
      const [prep] = await Promise.all([
        fetch(prepareUrl, { method: 'POST' }).then((r) => r.json()),
        loadPaystackScript(),
      ]);
      if (!prep.success) { toast.error(prep.error || 'Could not start payment'); return; }
      const { reference, amountKobo, email, planCode } = prep.data;

      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email,
        amount: amountKobo,
        ref: reference,
        plan: planCode || undefined,
        metadata: metadata || {},
        onClose: () => { if (mounted.current) setLoading(false); },
        callback: () => {
          toast.success('Payment received — confirming, this can take a few seconds...');
          if (mounted.current) setLoading(false);
          setTimeout(() => onPaid?.(), 3000);
        },
      });
      handler.openIframe();
    } catch (e) {
      toast.error(e.message || 'Could not start payment');
      setLoading(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={loading} className={className || `${btnPrimaryCls} disabled:opacity-50`}>
      {loading ? 'Opening...' : label}
    </button>
  );
}
