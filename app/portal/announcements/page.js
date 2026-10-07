'use client';

import { useEffect, useState } from 'react';
import { Card, Loader, PageHeader } from '@/components/ui';

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState(null);
  useEffect(() => {
    fetch('/api/portal/announcements').then((response) => response.json()).then((result) => {
      setAnnouncements(result.success ? result.data : []);
    });
  }, []);
  if (!announcements) return <Loader />;
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Announcements from your branches" />
      <div className="space-y-3">
        {announcements.length === 0 && <Card className="p-5 text-sm text-gray-500">No announcements yet.</Card>}
        {announcements.map((message) => (
          <Card key={message.id} className="p-5">
            <p className="text-xs font-semibold text-brand-700">{message.branch?.name || 'Earlier organization notice'}</p>
            <p className="text-xs text-gray-500">{new Date(message.createdAt).toLocaleString()}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
