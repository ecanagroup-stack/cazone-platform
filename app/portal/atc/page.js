'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, StatusPill } from '@/components/ui';
import { formatMoney, formatDateTime } from '@/lib/format';
import PaystackButton from '@/components/billing/PaystackButton';

function countdown(until, now) {
  const seconds = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function PortalAtcPage() {
  const { data: authSession } = useSession();
  const [data, setData] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    fetch('/api/portal/atc').then((r) => r.json()).then((d) => {
      if (d.success) setData(d.data);
      else toast.error(d.error || 'Failed to load');
    });
  }, []);

  useEffect(load, [load]);

  const held = data?.held?.[0];
  useEffect(() => {
    if (!held) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [held]);
  // The hold ran out: the ATC is back on sale (or someone else's), so refresh the lists.
  useEffect(() => {
    if (held && new Date(held.reservedUntil).getTime() <= now) load();
  }, [held, now, load]);

  // The webhook, not the popup, is what sells the ATC, and it can arrive late: after a payment keep checking
  // for a while so the ATC moves to the orders list on its own, and meanwhile do not offer it again.
  const [confirming, setConfirming] = useState(null);
  useEffect(() => {
    if (!confirming) return undefined;
    if (data?.orders.some((order) => order.id === confirming.id)) { setConfirming(null); return undefined; }
    if (confirming.polls >= 10) {
      toast('Still confirming your payment — it will show under Your ATC orders shortly.');
      setConfirming(null);
      return undefined;
    }
    const t = setTimeout(() => { load(); setConfirming((c) => (c ? { ...c, polls: c.polls + 1 } : c)); }, 3000);
    return () => clearTimeout(t);
  }, [confirming, data, load]);

  const payButton = (atc, label) => (
    <PaystackButton
      prepareUrl="/api/portal/atc/orders"
      prepareBody={{ atcId: atc.id }}
      metadata={{ type: 'atc_order', atcId: atc.id, customerId: authSession?.user?.customerId, organizationId: authSession?.user?.organizationId }}
      label={label}
      disabled={!authSession?.user?.customerId}
      onPrepared={load}
      onPaid={() => { load(); setConfirming({ id: atc.id, polls: 0 }); }}
    />
  );
  const confirmingNote = <p className="text-xs text-gray-500">Payment received — confirming...</p>;

  if (!data) return <Loader />;

  return (
    <div>
      <PageHeader title="Order ATC" subtitle="Pay for an ATC online. Once it is paid, the truck and driver details appear here." />

      {!data.canPayOnline && (
        <Card className="mb-4 p-4 text-sm text-amber-800">Online payment is not set up for this business yet. Contact us to buy an ATC.</Card>
      )}

      {held && (
        <Card className="mb-6 border-brand-500 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{held.serial} is held for you</p>
              <p className="text-xs text-gray-500">{held.litres.toLocaleString('en-NG')} litres {held.fuel} · {formatMoney(held.totalPrice / 100)}</p>
              <p className="mt-1 text-xs text-amber-700">Pay within {countdown(held.reservedUntil, now)} or it goes back on sale.</p>
            </div>
            {confirming?.id === held.id ? confirmingNote : payButton(held, 'Pay Now')}
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-base font-semibold text-gray-900">Available ATCs</h2>
      {data.available.length === 0 ? (
        <Card><EmptyState title="No ATCs available right now" subtitle="Check back soon." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.available.map((atc) => (
            <Card key={atc.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{atc.serial}</p>
                  <p className="text-sm text-gray-600">{atc.fuel}</p>
                </div>
                <p className="text-lg font-bold">{formatMoney(atc.totalPrice / 100)}</p>
              </div>
              <p className="mt-2 text-xs text-gray-500">{atc.litres.toLocaleString('en-NG')} litres at {formatMoney(atc.unitPrice / 100)} per litre</p>
              {data.canPayOnline && (
                <div className="mt-3">
                  {confirming?.id === atc.id ? confirmingNote
                    : held && held.id !== atc.id
                      ? <p className="text-xs text-gray-400">Finish paying for {held.serial} first</p>
                      : payButton(atc, held ? 'Pay Now' : 'Buy & Pay')}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <section className="mt-8" aria-label="Your ATC orders">
        <h2 className="mb-3 text-base font-semibold text-gray-900">Your ATC orders</h2>
        {data.orders.length === 0 ? <Card className="p-4 text-sm text-gray-500">No ATC orders yet.</Card> : (
          <div className="space-y-3">
            {data.orders.map((order) => (
              <Card key={order.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{order.serial}</p>
                    <p className="text-xs text-gray-500">{order.litres.toLocaleString('en-NG')} litres {order.fuel} · paid {formatDateTime(order.paidAt)}</p>
                  </div>
                  <StatusPill status={order.status === 'delivered' ? 'Delivered' : 'Paid - awaiting pickup'} color={order.status === 'delivered' ? 'green' : 'blue'} />
                </div>
                <p className="mt-2 text-sm font-semibold">{formatMoney(order.totalPrice / 100)}</p>
                <p className="mt-1 text-sm text-gray-600">
                  Truck {order.truckPlate || '-'} · Driver {order.driverName || '-'}{order.driverPhone ? ` (${order.driverPhone})` : ''}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
