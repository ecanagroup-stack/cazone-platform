'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const POLL_MS = 30000;
const CountsContext = createContext({ chat: 0, pendingOrders: 0, refresh: () => {} });

// One poller for the admin shell's badge counts, shared by the quick-actions strip and the sidebar so
// /api/admin/quick-counts is hit once per interval. Pages that clear items (confirming a pending
// order) call refresh() so the badges drop without waiting for the next tick.
export default function AdminCountsProvider({ enabled = true, children }) {
  const [counts, setCounts] = useState({ chat: 0, pendingOrders: 0 });

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const d = await fetch('/api/admin/quick-counts').then((r) => r.json());
      if (d.success) setCounts({ chat: d.data.chat, pendingOrders: d.data.pendingOrders });
    } catch { /* keep the last counts */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  const value = useMemo(() => ({ ...counts, refresh }), [counts, refresh]);
  return <CountsContext.Provider value={value}>{children}</CountsContext.Provider>;
}

export function useAdminCounts() {
  return useContext(CountsContext);
}
