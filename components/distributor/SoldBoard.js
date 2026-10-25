'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Card, EmptyState, Loader, StatusPill, btnPrimaryCls } from '@/components/ui';
import { formatDateTime, formatMoney } from '@/lib/format';

const POLL_MS = 30000;
const METHOD_LABEL = { cash: 'Cash', transfer: 'Transfer', pos: 'POS', paystack: 'Paid online' };

// Sold ATCs waiting for the driver (or, with status="delivered", the delivery history). The ATC manager
// verbally instructs the driver named on the card, then taps Mark delivered. Never shows the real ATC number.
export default function SoldBoard({ status = 'sold' }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/distributor/orders?status=${status}`);
    const result = await response.json();
    if (result.success) { setData(result.data); setFailed(false); }
    else { setFailed(true); toast.error(result.error || 'Could not load sold ATCs'); }
  }, [status]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function deliver(order) {
    if (!window.confirm(`Mark ${order.serial} as delivered to ${order.customer?.name || 'the customer'}?`)) return;
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/admin/distributor/orders/${order.id}/deliver`, { method: 'POST' });
      const result = await response.json();
      if (!result.success) return toast.error(result.error || 'Could not mark delivered');
      toast.success(`${order.serial} marked delivered`);
      await load();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (!data && failed) return <Card><EmptyState title="Could not load sold ATCs" subtitle="Check your connection or permissions and try again." /></Card>;
  if (!data) return <Loader />;
  if (data.orders.length === 0) {
    return <Card><EmptyState title={status === 'sold' ? 'No sold ATCs waiting' : 'No delivered ATCs yet'} subtitle={status === 'sold' ? 'When a customer pays for an ATC it shows up here.' : undefined} /></Card>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data.orders.map((order) => (
        <Card key={order.id} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-gray-900">{order.serial}</p>
              <p className="text-sm text-gray-600">{order.litres.toLocaleString('en-NG')} L · {order.product.name}</p>
            </div>
            <StatusPill status={status === 'sold' ? 'Sold' : 'Delivered'} color={status === 'sold' ? 'amber' : 'green'} />
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <Row label="Customer" value={order.customer?.name} />
            <Row label="Phone" value={order.customer?.phone} />
            <Row label="Business" value={order.customer?.businessName} />
            <Row label="Truck" value={order.truckPlate} />
            <Row label="Driver" value={[order.driverName, order.driverPhone].filter(Boolean).join(' · ')} />
            <Row label="Amount" value={formatMoney(order.totalPrice / 100)} strong />
            <Row label="Paid" value={`${formatDateTime(order.paidAt)} · ${METHOD_LABEL[order.paymentMethod] || order.paymentMethod}`} />
            {status === 'delivered' && <Row label="Delivered" value={formatDateTime(order.deliveredAt)} />}
          </dl>
          {status === 'sold' && data.canDeliver && (
            <button onClick={() => deliver(order)} disabled={busyId === order.id} className={`${btnPrimaryCls} mt-4 w-full`}>
              {busyId === order.id ? 'Saving...' : 'Mark delivered'}
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`text-right ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{value || '—'}</dd>
    </div>
  );
}
