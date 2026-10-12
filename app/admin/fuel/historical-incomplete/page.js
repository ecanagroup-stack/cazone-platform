'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Loader, PageHeader } from '@/components/ui';

export default function HistoricalIncompletePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const branchId = searchParams.get('branch');

  useEffect(() => {
    const query = branchId ? `?branch=${encodeURIComponent(branchId)}` : '';
    router.replace(`/admin/fuel/backfill${query}`);
  }, [branchId, router]);

  return (
    <div>
      <PageHeader title="Historical Rebuild" subtitle="Opening the guided station history rebuild..." />
      <Card className="p-6">
        <Loader />
      </Card>
    </div>
  );
}
