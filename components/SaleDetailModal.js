'use client';

import { Modal, StatusPill, tableScrollCls, theadCls } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const money = (cents) => formatMoney(cents / 100);

// One sale from the Sales Transactions report, opened by clicking its reference. Edit and Mark delivered
// (only for a pending sale the viewer may change) hand the sale back to the caller, which opens
// EditPendingSaleModal.
export default function SaleDetailModal({ sale, deliveryEnabled, onClose, onEdit, onDeliver }) {
  if (!sale) return null;
  const costs = sale.lines.flatMap((line) => line.costs.map((cost) => ({ ...cost, product: line.product })));

  return <Modal open onClose={onClose} title={`Sale ${sale.reference}`} size="2xl">
    <div className="space-y-4">
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <Info label="Sale date" value={formatDate(sale.date)} />
        <Info label="Customer" value={sale.customer} />
        <Info label="Branch" value={sale.branch} />
        <Info label="Payment" value={<span className="capitalize">{sale.paymentMethod}</span>} />
        {deliveryEnabled && <Info label="Delivery" value={<StatusPill status={sale.deliveryStatus === 'pending' ? 'Pending' : 'Delivered'} color={sale.deliveryStatus === 'pending' ? 'amber' : 'green'} />} />}
        {deliveryEnabled && sale.deliveryStatus !== 'pending' && <Info label="Delivery date" value={sale.deliveryDate ? formatDate(sale.deliveryDate) : 'Not recorded'} />}
      </dl>

      <div className={`${tableScrollCls} border rounded`}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-3 py-2 text-left font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Transport</th>
              <th className="px-3 py-2 text-left font-medium">Truck / Driver</th>
              <th className="px-3 py-2 text-left font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sale.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2 font-medium">{line.product}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {line.qty.toLocaleString()} {line.unit}
                  {line.stockQty != null && line.stockQty !== line.qty && <span className="block text-xs text-gray-500">supplied {line.stockQty.toLocaleString()}</span>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{money(line.unitPrice)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{money(line.lineTotal)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{money(line.transportFee)}</td>
                <td className="px-3 py-2">{line.truck || '—'}{line.driver && <span className="block text-xs text-gray-500">{line.driver}</span>}</td>
                <td className="px-3 py-2">{line.source || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {costs.length > 0 && <ul className="text-sm text-gray-600 space-y-1">
        {costs.map((cost) => <li key={cost.id} className="flex justify-between gap-3">
          <span className="capitalize">{cost.product} — {cost.type}{cost.detail ? `: ${cost.detail}` : ''}</span><span>{money(cost.amount)}</span>
        </li>)}
      </ul>}

      <div className="text-sm space-y-1 border-t pt-3">
        <p className="flex justify-between"><span className="text-gray-500">Sales amount{sale.discount > 0 && ` (after ${money(sale.discount)} discount)`}</span><span>{money(sale.salesAmount)}</span></p>
        <p className="flex justify-between"><span className="text-gray-500">Transport</span><span>{money(sale.transportAmount)}</span></p>
        <p className="flex justify-between font-semibold text-base"><span>Total</span><span>{money(sale.total)}</span></p>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded hover:bg-gray-50">Close</button>
        {sale.editable && <>
          <button type="button" onClick={() => onEdit(sale)} className="flex-1 px-4 py-2 border border-brand-600 text-brand-700 rounded font-medium hover:bg-brand-50">Edit</button>
          <button type="button" onClick={() => onDeliver(sale)} className="flex-1 px-4 py-2 bg-brand-600 text-white rounded font-medium hover:bg-brand-700">Mark delivered</button>
        </>}
      </div>
    </div>
  </Modal>;
}

function Info({ label, value }) {
  return <div><dt className="text-xs text-gray-500">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
