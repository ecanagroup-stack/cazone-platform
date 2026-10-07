'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyState, Modal, FormButtons, inputCls, btnPrimaryCls, theadCls, tableScrollCls } from '@/components/ui';

const POLL_MS = 30000;

export default function MessagesInboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(searchParams.get('branchId') || searchParams.get('branch') || '');
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState('');
  const [audience, setAudience] = useState('selected');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/chat${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`);
    const d = await r.json();
    if (d.success) { setConversations(d.data.conversations); setBranches(d.data.branches); if (d.data.branchId !== branchId) setBranchId(d.data.branchId || ''); }
    else if (r.status === 403 && branchId) setBranchId('');
    else toast.error(d.error || 'Failed to load');
  }, [branchId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { if (searchParams.get('announce') === '1') setShowBroadcast(true); }, [searchParams]);

  const openBroadcast = () => {
    setBroadcastBody('');
    setAudience('selected');
    setRecipientSearch('');
    setSelectedIds([]);
    setShowBroadcast(true);
  };

  const toggleId = (id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  const visibleRecipients = (conversations || []).filter(({ customer }) => `${customer.name} ${customer.businessName || ''} ${customer.phone || ''}`.toLowerCase().includes(recipientSearch.toLowerCase()));
  const toggleAll = () => setSelectedIds((ids) => {
    const visibleIds = visibleRecipients.map((conversation) => conversation.customer.id);
    return visibleIds.every((id) => ids.includes(id)) ? ids.filter((id) => !visibleIds.includes(id)) : [...new Set([...ids, ...visibleIds])];
  });

  const handleSendBroadcast = async (e) => {
    e.preventDefault();
    if (audience === 'selected' && selectedIds.length === 0) return toast.error('Pick at least one customer');
    setSending(true);
    try {
      const r = await fetch('/api/admin/chat/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, audience, customerIds: audience === 'selected' ? selectedIds : [], body: broadcastBody }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`Sent to ${d.data.sentCount} customer${d.data.sentCount === 1 ? '' : 's'} at ${d.data.branchName}`); setShowBroadcast(false); load(); }
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
        subtitle="Branch conversations with customers who have portal access"
        action={<button onClick={openBroadcast} disabled={!conversations.length || !branches.find((branch) => branch.id === branchId)?.isActive} className="px-4 py-2 border rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Send Notification</button>}
      />
      <div className="mb-4 max-w-sm">
        <label htmlFor="message-branch" className="mb-1 block text-sm font-medium text-gray-700">Branch</label>
        <select id="message-branch" value={branchId} onChange={(event) => { setConversations(null); setBranchId(event.target.value); setSelectedIds([]); }} className={inputCls}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.isActive ? '' : ' (inactive)'}</option>)}
        </select>
      </div>

      <Card className="overflow-hidden">
        {conversations.length === 0 ? (
          <EmptyState title="No customers with portal access at this branch" subtitle="Enable portal access on a customer account before sending a notification or chatting." />
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
                  <tr key={customer.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/admin/messages/${customer.id}?branchId=${encodeURIComponent(branchId)}`)}>
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

      <Modal open={showBroadcast} onClose={() => setShowBroadcast(false)} title="Send Customer Notification" size="lg">
        <form onSubmit={handleSendBroadcast} className="space-y-4">
          <p className="text-sm text-gray-600">Sending from {branches.find((branch) => branch.id === branchId)?.name}. Customers will see this under Notifications and Messages.</p>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="audience" checked={audience === 'selected'} onChange={() => setAudience('selected')} /> Selected customers</label>
            <label className="flex items-center gap-2"><input type="radio" name="audience" checked={audience === 'branch'} onChange={() => setAudience('branch')} /> Everyone with portal access at this branch ({conversations.length})</label>
          </div>
          {audience === 'selected' && <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Recipients</label>
              <button type="button" onClick={toggleAll} className="text-xs font-medium text-brand-600 hover:underline">
                {visibleRecipients.length > 0 && visibleRecipients.every(({ customer }) => selectedIds.includes(customer.id)) ? 'Deselect matches' : 'Select matches'}
              </button>
            </div>
            <input type="search" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Find a customer" className={`${inputCls} mb-2`} />
            <div className="border rounded max-h-48 overflow-y-auto divide-y">
              {visibleRecipients.map(({ customer }) => (
                <label key={customer.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.includes(customer.id)} onChange={() => toggleId(customer.id)} />
                  {customer.name}
                  {customer.businessName && <span className="text-xs text-gray-400"> — {customer.businessName}</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">{selectedIds.length} selected</p>
          </div>
          </>}
          <div>
            <label className="block text-sm font-medium mb-1">Message</label>
            <textarea value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)} rows={4} className={inputCls} required />
          </div>
          <FormButtons onCancel={() => setShowBroadcast(false)} submitting={sending} submitLabel={audience === 'branch' ? 'Notify Branch' : 'Notify Selected Customers'} />
        </form>
      </Modal>
    </div>
  );
}
