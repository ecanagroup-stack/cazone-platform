'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const POLL_MS = 30000;
const CountsContext = createContext({ chat: 0, pendingOrders: 0, soldAtcs: 0, refresh: () => {} });

// One poller for the admin shell's badge counts, shared by the quick-actions strip and the sidebar so
// /api/admin/quick-counts is hit once per interval. Pages that clear items (confirming a pending
// order) call refresh() so the badges drop without waiting for the next tick. `enabled` polls the chat and
// pending-order counts; `atc` polls the sold-ATC count (distributor add-on) from its own endpoint.
export default function AdminCountsProvider({ enabled = true, atc = false, children }) {
  const [counts, setCounts] = useState({ chat: 0, pendingOrders: 0, soldAtcs: 0 });

  const refresh = useCallback(async () => {
    try {
      const [quick, sold] = await Promise.all([
        enabled ? fetch('/api/admin/quick-counts').then((r) => r.json()) : null,
        atc ? fetch('/api/admin/distributor/pending-count').then((r) => r.json()) : null,
      ]);
      setCounts((c) => ({
        chat: quick?.success ? quick.data.chat : c.chat,
        pendingOrders: quick?.success ? quick.data.pendingOrders : c.pendingOrders,
        soldAtcs: sold?.success ? sold.data.count : c.soldAtcs,
      }));
    } catch { /* keep the last counts */ }
  }, [enabled, atc]);

  useEffect(() => {
    if (!enabled && !atc) return undefined;
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, atc, refresh]);

  const value = useMemo(() => ({ ...counts, refresh }), [counts, refresh]);
  return <CountsContext.Provider value={value}>{children}</CountsContext.Provider>;
}

export function useAdminCounts() {
  return useContext(CountsContext);
}
