import { requireDistributorPage } from '@/lib/businessPage';
import { getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import DistributorNav from '@/components/distributor/DistributorNav';

export default async function DistributorLayout({ children }) {
  await requireDistributorPage();
  const { role } = (await getOrgSession()).user;
  const canView = can(role, 'atc.view');
  const links = [
    canView && { href: '/admin/distributor', label: 'Dashboard', exact: true },
    canView && { href: '/admin/distributor/atcs', label: 'ATCs' },
    canView && { href: '/admin/distributor/orders', label: 'Sold ATCs' },
    can(role, 'atc.sell') && { href: '/admin/distributor/sell', label: 'Sell ATC' },
    (canView || ['owner', 'manager'].includes(role)) && { href: '/admin/distributor/prices', label: 'Prices' },
  ].filter(Boolean);
  return (
    <div>
      <DistributorNav links={links} />
      {children}
    </div>
  );
}
