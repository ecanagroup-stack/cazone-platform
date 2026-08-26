'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, Modal, FormButtons, inputCls, btnPrimaryCls, theadCls, tableScrollCls } from '@/components/ui';

const POLL_MS = 30000;

export default function MessagesInboxPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState(null);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/chat');
    const d = await r.json();
    if (d.success) setConversations(d.data); else toast.error(d.error || 'Failed to load');
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const openBroadcast = () => {
    setBroadcastBody('');
    setSelectedIds([]);
    setShowBroadcast(true);
  };

  const toggleId = (id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  const toggleAll = () => setSelectedIds((ids) => (ids.length === conversations.length ? [] : conversations.map((c) => c.customer.id)));

  const handleSendBroadcast = async (e) => {
    e.preventDefault();
    if (selectedIds.length === 0) return toast.error('Pick at least one customer');
    setSending(true);
    try {
      const r = await fetch('/api/admin/chat/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerIds: selectedIds, body: broadcastBody }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`Sent to ${d.data.sentCount} customer${d.data.sentCount === 1 ? '' : 's'}`); setShowBroadcast(false); load(); }
      else toast.error(d.error);
    } finally {
      setSending(false);
    }
  };

  if (!conversations) return <Loader />;

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Conversations with customers who have portal access"
        action={<button onClick={openBroadcast} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50">New Broadcast</button>}
      />

      <Card className="overflow-hidden">
        {conversations.length === 0 ? (
          <EmptyState title="No conversations yet" subtitle="Once a customer with portal access sends a message, it shows up here." />
        ) : (
          <div className={tableScrollCls}>
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-left font-medium">Last message</th>
                  <th className="px-4 py-3 text-right font-medium">When</th>
                  <th className="px-4 py-3 text-right font-medium">Unread</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {conversations.map(({ customer, lastMessage, unreadCount }) => (
                  <tr key={customer.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/admin/messages/${customer.id}`)}>
                    <td className="px-4 py-3 font-medium">
                      {customer.name}
                      {customer.businessName && <span className="text-xs text-gray-400 font-normal"> — {customer.businessName}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-md truncate">
                      {lastMessage ? (lastMessage.fromCustomer ? '' : `${lastMessage.senderName}: `) + lastMessage.body : <span className="text-gray-400">No messages yet</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">
                      {lastMessage ? new Date(lastMessage.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {unreadCount > 0 && (
                        <span className="inline-flex min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-medium items-center justify-center">
                          {unreadCount}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showBroadcast} onClose={() => setShowBroadcast(false)} title="New Broadcast" size="lg">
        <form onSubmit={handleSendBroadcast} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Recipients</label>
              <button type="button" onClick={toggleAll} className="text-xs font-medium text-brand-600 hover:underline">
                {selectedIds.length === conversations.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="border rounded max-h-48 overflow-y-auto divide-y">
              {conversations.map(({ customer }) => (
                <label key={customer.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.includes(customer.id)} onChange={() => toggleId(customer.id)} />
                  {customer.name}
                  {customer.businessName && <span className="text-xs text-gray-400"> — {customer.businessName}</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">{selectedIds.length} selected</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Message</label>
            <textarea value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)} rows={4} className={inputCls} required />
          </div>
          <FormButtons onCancel={() => setShowBroadcast(false)} submitting={sending} submitLabel="Send Broadcast" />
        </form>
      </Modal>
    </div>
  );
}
