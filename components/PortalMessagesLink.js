'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const POLL_MS = 30000;

export default function PortalMessagesLink({ className }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const load = () => fetch('/api/portal/chat/unread-count').then((r) => r.json()).then((d) => { if (d.success) setUnread(d.data.count); });
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <Link href="/portal/messages" className={`${className} relative`}>
      Messages
      {unread > 0 && <span className="absolute -top-1.5 -right-2.5 h-2 w-2 rounded-full bg-red-500" />}
    </Link>
  );
}
