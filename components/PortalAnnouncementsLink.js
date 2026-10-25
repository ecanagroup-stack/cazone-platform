'use client';

import Link from 'next/link';
import { usePortalCounts, CountBadge } from '@/components/portal/PortalCountsProvider';

export default function PortalAnnouncementsLink({ className = '' }) {
  const { notifications } = usePortalCounts();
  return <Link href="/portal/announcements" className={`${className} relative`}>
    Notifications
    <CountBadge count={notifications} label="notifications" className="absolute -top-2 -right-4" />
  </Link>;
}
