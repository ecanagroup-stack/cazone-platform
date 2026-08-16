'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, StatusPill } from '@/components/ui';
import { formatMoney } from '@/lib/format';

export default function PortalOverviewPage() {
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    fetch('/api/portal/me').then((r) => r.json()).then((d) => {
      if (d.success) setCustomer(d.data);
      else toast.error(d.error || 'Failed to load');
    });
  }, []);

  if (!customer) return <Loader />;

  const available = customer.creditLimit - customer.balance;

  return (
    <div>
      <PageHeader title={customer.name} subtitle={customer.businessName || ''} />

      {customer.onHold && (
        <Card className="p-3 mb-4 border-red-300 bg-red-50 text-sm text-red-800">
          This account is on hold — contact us if you have questions about a recent order.
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4"><p className="text-xs text-gray-500">Balance</p><p className="text-2xl font-bold mt-1">{formatMoney(customer.balance / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Credit Limit</p><p className="text-2xl font-bold mt-1">{formatMoney(customer.creditLimit / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Available</p><p className={`text-2xl font-bold mt-1 ${available < 0 ? 'text-red-600' : ''}`}>{formatMoney(available / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Status</p><div className="mt-1">{customer.onHold ? <StatusPill status="On Hold" color="red" /> : <StatusPill status="Active" color="green" />}</div></Card>
      </div>
    </div>
  );
}
