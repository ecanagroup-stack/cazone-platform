'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const POLL_MS = 30000;
const CountsContext = createContext({ chat: 0, notifications: 0, refresh: () => {} });

// One poller for the portal's two unread counts, shared by the nav links and the dashboard cards so
// each endpoint is hit once per interval no matter how many badges are on screen. Pages that mark
// items read call refresh() so the badges drop without waiting for the next tick.
export default function PortalCountsProvider({ children }) {
  const [counts, setCounts] = useState({ chat: 0, notifications: 0 });

  const refresh = useCallback(async () => {
    const read = (url) => fetch(url).then((r) => r.json()).then((d) => (d.success ? d.data.count : null)).catch(() => null);
    const [chat, notifications] = await Promise.all([
      read('/api/portal/chat/unread-count'),
      read('/api/portal/announcements/unread-count'),
    ]);
    setCounts((prev) => ({ chat: chat ?? prev.chat, notifications: notifications ?? prev.notifications }));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo(() => ({ ...counts, refresh }), [counts, refresh]);
  return <CountsContext.Provider value={value}>{children}</CountsContext.Provider>;
}

export function usePortalCounts() {
  return useContext(CountsContext);
}

export function CountBadge({ count, label, className = '' }) {
  if (!count) return null;
  return (
    <span aria-label={`${count} unread ${label}`} className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
