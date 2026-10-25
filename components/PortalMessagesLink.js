'use client';

import Link from 'next/link';
import { usePortalCounts, CountBadge } from '@/components/portal/PortalCountsProvider';

export default function PortalMessagesLink({ className }) {
  const { chat } = usePortalCounts();

  return (
    <Link href="/portal/messages" className={`${className} relative`}>
      Chat
      <CountBadge count={chat} label="chat messages" className="absolute -top-2 -right-4" />
    </Link>
  );
}
