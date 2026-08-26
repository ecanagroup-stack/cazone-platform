'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Loader, Card, inputCls, btnPrimaryCls } from '@/components/ui';

const POLL_MS = 8000;

export default function MessageThreadPage() {
  const { customerId } = useParams();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/chat/${customerId}`);
    const d = await r.json();
    if (d.success) setData(d.data); else toast.error(d.error || 'Failed to load');
  }, [customerId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages?.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const r = await fetch(`/api/admin/chat/${customerId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
      });
      const d = await r.json();
      if (d.success) { setDraft(''); load(); } else toast.error(d.error);
    } finally {
      setSending(false);
    }
  };

  if (!data) return <Loader />;

  const { customer, messages } = data;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <Link href="/admin/messages" className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-2">
          <FiArrowLeft size={14} /> All Messages
        </Link>
        <h1 className="text-xl font-bold text-gray-900">
          {customer.name}
          {customer.businessName && <span className="text-sm font-normal text-gray-400"> — {customer.businessName}</span>}
        </h1>
        <p className="text-sm text-gray-500">
          {customer.phone || 'No phone on file'} ·{' '}
          <Link href={`/admin/customers/${customer.id}`} className="text-brand-600 hover:underline">View account</Link>
        </p>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No messages yet</p>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.fromCustomer ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[70%] rounded-lg px-3 py-2 ${m.fromCustomer ? 'bg-gray-100 text-gray-900' : 'bg-brand-600 text-white'}`}>
                {!m.fromCustomer && (
                  <p className="text-xs opacity-75 mb-0.5">
                    {m.senderName}{m.broadcastId && ' · Broadcast'}
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[11px] mt-1 ${m.fromCustomer ? 'text-gray-400' : 'text-white/70'}`}>
                  {new Date(m.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="border-t p-3 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a reply…"
            className={inputCls}
            autoFocus
          />
          <button type="submit" disabled={sending || !draft.trim()} className={btnPrimaryCls}>Send</button>
        </form>
      </Card>
    </div>
  );
}
