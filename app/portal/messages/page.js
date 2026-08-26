'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, inputCls, btnPrimaryCls } from '@/components/ui';

const POLL_MS = 8000;

export default function PortalMessagesPage() {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/portal/chat');
    const d = await r.json();
    if (d.success) setMessages(d.data.messages); else toast.error(d.error || 'Failed to load');
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const r = await fetch('/api/portal/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
      });
      const d = await r.json();
      if (d.success) { setDraft(''); load(); } else toast.error(d.error);
    } finally {
      setSending(false);
    }
  };

  if (!messages) return <Loader />;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader title="Messages" subtitle="Chat with the team about your account" />

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No messages yet — send one to get started.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.fromCustomer ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 ${m.fromCustomer ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                {!m.fromCustomer && (
                  <p className="text-xs opacity-75 mb-0.5">
                    {m.broadcastId ? 'Announcement' : m.senderName}
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[11px] mt-1 ${m.fromCustomer ? 'text-white/70' : 'text-gray-400'}`}>
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
            placeholder="Type a message…"
            className={inputCls}
            autoFocus
          />
          <button type="submit" disabled={sending || !draft.trim()} className={btnPrimaryCls}>Send</button>
        </form>
      </Card>
    </div>
  );
}
