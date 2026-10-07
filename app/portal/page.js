'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, StatusPill } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import PortalPayBalanceButton from '@/components/PortalPayBalanceButton';
import { FiMessageCircle, FiBell, FiShoppingBag, FiArrowUpRight } from 'react-icons/fi';

export default function PortalOverviewPage() {
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    fetch('/api/portal/me').then((r) => r.json()).then((d) => {
      if (d.success) setCustomer(d.data);
      else toast.error(d.error || 'Failed to load');
    });
  }, []);

  if (!customer) return <Loader />;

  const available = customer.creditLimit === null ? null : customer.creditLimit - customer.balance;

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
        <Card className="p-4"><p className="text-xs text-gray-500">Credit Limit</p><p className="text-2xl font-bold mt-1">{customer.creditLimit === null ? 'Unlimited' : formatMoney(customer.creditLimit / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Available</p><p className={`text-2xl font-bold mt-1 ${available !== null && available < 0 ? 'text-red-600' : ''}`}>{available === null ? 'Unlimited' : formatMoney(available / 100)}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Status</p><div className="mt-1">{customer.onHold ? <StatusPill status="On Hold" color="red" /> : <StatusPill status="Active" color="green" />}</div></Card>
      </div>

      {customer.paymentsEnabled && customer.balance > 0 && <PortalPayBalanceButton />}
      <div className="mt-7">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Your actions</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ...(['shop', 'general_store'].includes(customer.businessType)
              ? [{ href: '/portal/order', title: 'Order', description: 'Request goods from your branch.', Icon: FiShoppingBag }]
              : []),
            { href: '/portal/messages', title: 'Chat', description: `Talk with ${customer.organizationName || 'your organization'}.`, Icon: FiMessageCircle },
            { href: '/portal/announcements', title: 'Notifications', description: `Read announcements from ${customer.organizationName || 'your organization'}.`, Icon: FiBell },
          ].map(({ href, title, description, Icon }) => (
            <Link key={title} href={href} className="group flex min-h-36 flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand-500 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
              <div className="flex items-start justify-between"><Icon className="text-brand-700" size={22} aria-hidden="true" /><FiArrowUpRight className="text-gray-400 transition group-hover:text-brand-700" aria-hidden="true" /></div>
              <div><strong className="text-base text-gray-900">{title}</strong><p className="mt-1 text-sm leading-5 text-gray-500">{description}</p></div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
