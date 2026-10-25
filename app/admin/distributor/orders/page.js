'use client';

import { useState } from 'react';
import { PageHeader, Tabs } from '@/components/ui';
import SoldBoard from '@/components/distributor/SoldBoard';

export default function DistributorOrdersPage() {
  const [tab, setTab] = useState('sold');
  return (
    <div>
      <PageHeader title="Sold ATCs" subtitle="Paid ATCs: instruct the driver, then mark the ATC delivered" />
      <Tabs tabs={[{ key: 'sold', label: 'Awaiting delivery' }, { key: 'delivered', label: 'Delivered' }]} active={tab} onChange={setTab} />
      <SoldBoard key={tab} status={tab} />
    </div>
  );
}
