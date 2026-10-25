'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FiBell } from 'react-icons/fi';
import { formatDate } from '@/lib/format';

// Polls rather than pushes — matches the old apps' notification approach (in-app, client-polled, no
// push/websocket infra) and needs nothing new on the server beyond the REST routes.
const POLL_MS = 30000;

export default function NotificationBell({ role }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/notifications');
    const d = await r.json();
    if (d.success) setNotifications(d.data);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAllRead = async () => {
    await fetch('/api/admin/notifications', { method: 'PATCH' });
    load();
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open && unreadCount > 0) markAllRead(); }}
        className="relative p-2 text-gray-500 hover:text-gray-900"
      >
        <FiBell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
        )}
      </button>
      {open && (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white border rounded-lg shadow-lg py-1 z-20 max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-400 text-center">No notifications yet</p>
            ) : (
              notifications.map((n) => {
                const body = (
                  <>
                    <p className="text-sm font-medium text-gray-900">{n.title}</p>
                    <p className="text-xs text-gray-500">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(n.createdAt)}</p>
                  </>
                );
                // A sold ATC is work to act on: take the ATC manager straight to the sold board. A payment
                // that could not buy its ATC is a refund Flag, which is listed with the other exceptions (the
                // fuel ATC manager is confined to the distribution pages, so theirs opens the sold board).
                const href = n.type === 'atc_sold' ? '/admin/distributor/orders'
                  : n.type === 'atc_paid_conflict' ? (role === 'atc_manager' ? '/admin/distributor/orders' : '/admin/exceptions')
                  : null;
                return href ? (
                  <Link key={n.id} href={href} onClick={() => setOpen(false)} className="block px-3 py-2 border-b last:border-b-0 hover:bg-gray-50">{body}</Link>
                ) : (
                  <div key={n.id} className="px-3 py-2 border-b last:border-b-0">{body}</div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
