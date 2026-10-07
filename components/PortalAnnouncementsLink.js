'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function PortalAnnouncementsLink({ className = '' }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const load = () => fetch('/api/portal/announcements/unread-count').then((response) => response.json()).then((result) => {
      if (result.success) setUnread(result.data.count);
    });
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);
  return <Link href="/portal/announcements" className={`${className} relative`}>
    Notifications
    {unread > 0 && <span aria-label={`${unread} unread notifications`} className="absolute -top-1.5 -right-2.5 h-2 w-2 rounded-full bg-red-500" />}
  </Link>;
}
