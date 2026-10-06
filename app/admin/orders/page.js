'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Loader, PageHeader, EmptyRow, theadCls, tableScrollCls } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';

export default function OrdersPage() {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    fetch('/api/admin/orders').then((response) => response.json()).then((result) => setOrders(result.success ? result.data : []));
  }, []);
  if (!orders) return <Loader />;
  return (
    <div>
      <PageHeader title="Orders" subtitle="Recent customer and staff orders" />
      <Card className="overflow-hidden"><div className={tableScrollCls}><table className="w-full text-sm">
        <thead className={theadCls}><tr>
          <th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Reference</th>
          <th className="px-4 py-3 text-left">Customer</th><th className="px-4 py-3 text-left">Products</th>
          <th className="px-4 py-3 text-left">Branch</th><th className="px-4 py-3 text-left">Status</th>
          <th className="px-4 py-3 text-right">Total</th>
        </tr></thead>
        <tbody className="divide-y">
          {orders.length === 0 && <EmptyRow colSpan={7} text="No orders yet" />}
          {orders.map((order) => <tr key={order.id}>
            <td className="px-4 py-3">{formatDate(order.createdAt)}</td>
            <td className="px-4 py-3"><Link className="text-brand-600 hover:underline" href={`/admin/orders/${order.id}/receipt`}>{order.orderNumber}</Link></td>
            <td className="px-4 py-3">{order.customer?.name || 'Walk-in'}</td>
            <td className="px-4 py-3">{order.lines.map((line) => line.product.name).join(', ')}</td>
            <td className="px-4 py-3">{order.branch.name}</td>
            <td className="px-4 py-3 capitalize">{order.status}</td>
            <td className="px-4 py-3 text-right">{formatMoney(order.grandTotal / 100)}</td>
          </tr>)}
        </tbody>
      </table></div></Card>
    </div>
  );
}
