'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/format';

const CHANNEL_LABEL = { shop: 'General Store', atc: 'Wholesale' };

export default function PortalStatementPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/portal/statement').then((r) => r.json()).then((d) => {
      if (d.success) setData(d.data);
      else toast.error(d.error || 'Failed to load');
    });
  }, []);

  if (!data) return <Loader />;

  return (
    <div>
      <PageHeader title="Statement" subtitle="Every order and payment on your account" />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Entry</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.ledger.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-gray-500">No activity yet</td></tr>}
            {data.ledger.map((entry) => (
              <tr key={`${entry.type}-${entry.id}`}>
                <td className="px-4 py-2 text-gray-500">{formatDate(entry.date)}</td>
                <td className="px-4 py-2">
                  {entry.label}
                  {entry.channel && CHANNEL_LABEL[entry.channel] && (
                    <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{CHANNEL_LABEL[entry.channel]}</span>
                  )}
                </td>
                <td className={`px-4 py-2 text-right ${entry.amount < 0 ? 'text-green-700' : ''}`}>{formatMoney(entry.amount / 100)}</td>
                <td className="px-4 py-2 text-right font-medium">{formatMoney(entry.runningBalance / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
