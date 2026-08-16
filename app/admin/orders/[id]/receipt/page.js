'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { FiPrinter } from 'react-icons/fi';
import { Loader, Card, ReceiptHeader } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

// A printable receipt for any completed Order — fuel, materials, or retail all produce the same
// Order/OrderLine shape (lib/sale.js), so one generic document covers every pack rather than a
// per-vertical receipt template.
export default function OrderReceiptPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/orders/${id}`);
    const d = await r.json();
    if (d.success) setData(d.data);
    else toast.error(d.error || 'Failed to load receipt');
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <Loader />;

  const { order, organization } = data;
  const currency = organization?.currency || 'NGN';

  return (
    <div>
      <div className="print:hidden flex justify-end mb-4">
        <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
          <FiPrinter size={14} /> Print
        </button>
      </div>

      <Card className="receipt-page p-8 print:shadow-none print:border-0">
        <ReceiptHeader org={organization} refNumber={order.orderNumber} date={order.createdAt} title="Sales Receipt" />

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div>
            <p className="text-xs text-gray-500">Branch</p>
            <p className="font-medium">{order.branch?.name || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Customer</p>
            <p className="font-medium">{order.customer?.name || 'Walk-in'}</p>
          </div>
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500 uppercase">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit Price</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2">{l.product.name}</td>
                <td className="py-2 text-right">{l.qty.toLocaleString()} {l.product.unit}</td>
                <td className="py-2 text-right">{formatMoney(l.unitPrice / 100, currency)}</td>
                <td className="py-2 text-right">{formatMoney(l.lineTotal / 100, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <div className="w-56 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatMoney(order.subtotal / 100, currency)}</span></div>
            {order.discount > 0 && (
              <div className="flex justify-between"><span className="text-gray-500">Discount</span><span>-{formatMoney(order.discount / 100, currency)}</span></div>
            )}
            <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>{formatMoney(order.grandTotal / 100, currency)}</span></div>
            <div className="flex justify-between text-gray-500 text-xs pt-1"><span>Payment method</span><span className="capitalize">{order.paymentMethod || '—'}</span></div>
          </div>
        </div>

        {(organization?.bankName || organization?.accountNumber) && (
          <div className="text-xs text-gray-500 border-t pt-3 mb-2">
            <p className="font-medium text-gray-700 mb-1">Bank details</p>
            <p>{organization.bankName} — {organization.accountNumber} ({organization.accountName})</p>
          </div>
        )}
        {organization?.invoiceFooter && (
          <p className="text-xs text-gray-500 border-t pt-3">{organization.invoiceFooter}</p>
        )}
      </Card>
    </div>
  );
}
