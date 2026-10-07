import Link from 'next/link';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { requireOrg } from '@/lib/tenantScope';
import { Card, btnPrimaryCls } from '@/components/ui';

// Org-wide by default — "the organization's admin can see any and all his business" — with an
// honest empty state rather than fabricated numbers, since no pack has any sales/variance data yet.
// `/admin` is also every login's landing route (app/login/page.js), so this is where a saved
// service/branch preference (User.lastServiceId/lastBranchId, written by ServiceBranchSwitcher)
// gets restored — a multi-service/multi-branch org shouldn't have to re-pick on every login.
export default async function TodayPage({ searchParams }) {
  const params = await searchParams;
  const session = await getOrgSession();
  const orgId = requireOrg(session);

  const [organization, staffCount, me] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { businessType: true } }),
    prisma.user.count({ where: { role: { not: 'customer' } } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { lastServiceId: true, lastBranchId: true } }),
  ]);
  const allBusinessServices = await prisma.service.findMany({ where: { type: organization.businessType }, include: { branches: { where: { isActive: true } } }, orderBy: { createdAt: 'asc' } });
  const services = allBusinessServices.filter((service) => service.isActive || (service.type === 'fuel_station' && service.config?.migrationStockPending === true));

  if (organization.businessType === 'fuel_station') {
    const fuel = services[0];
    if (!fuel) return <div className="max-w-2xl space-y-4"><h1 className="text-2xl font-bold">Petrol Station</h1><Card className="p-6"><h2 className="font-semibold">Service unavailable</h2><p className="mt-2 text-sm text-gray-600">Contact your administrator for access to this business.</p>{session.user.role === 'owner' && <Link href="/admin/billing" className="mt-4 inline-block text-brand-700 font-medium">Manage subscription</Link>}</Card></div>;
    const branchId = params?.branch || me?.lastBranchId || (fuel.branches.length === 1 ? fuel.branches[0].id : '');
    const qs = new URLSearchParams({ service: fuel.id, ...(branchId ? { branch: branchId } : {}) });
    redirect(`/admin/fuel/dashboard?${qs.toString()}`);
  }

  if (!params?.service && !params?.branch && me?.lastServiceId) {
    const service = services.find((s) => s.id === me.lastServiceId && s.isActive);
    if (service) {
      const branch = me.lastBranchId ? service.branches.find((b) => b.id === me.lastBranchId && b.isActive) : null;
      const qs = new URLSearchParams({ service: service.id, ...(branch ? { branch: branch.id } : {}) });
      redirect(`/admin?${qs.toString()}`);
    }
  }

  const branchCount = services.reduce((sum, s) => sum + s.branches.length, 0);
  const selectedService = services.find((service) => service.id === params?.service)
    || (services.length === 1 ? services[0] : null);
  const selectedBranchId = selectedService?.branches.some((branch) => branch.id === params?.branch)
    ? params.branch : null;
  const availableAtcs = selectedService?.type === 'shop' ? await prisma.delivery.findMany({
    where: {
      product: { serviceId: selectedService.id, abbreviation: { not: null } },
      branch: { isActive: true },
      ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
      status: { in: ['loaded', 'arrived'] },
      qtyRemaining: { gt: 0 },
    },
    select: { qtyRemaining: true, productId: true, product: { select: { name: true } } },
  }) : null;
  const availableBags = availableAtcs?.reduce((total, atc) => total + atc.qtyRemaining, 0) || 0;
  const brandCounts = availableAtcs ? [...availableAtcs.reduce((byBrand, atc) => {
    const current = byBrand.get(atc.productId) || { id: atc.productId, name: atc.product.name, count: 0 };
    current.count += 1;
    byBrand.set(atc.productId, current);
    return byBrand;
  }, new Map()).values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const brandSummary = brandCounts.map((brand) => `${brand.count} ${brand.name}`).join(', ');
  const atcsHref = selectedService ? `/admin/materials/atcs?service=${selectedService.id}${selectedBranchId ? `&branch=${selectedBranchId}` : ''}` : '/admin/materials/atcs';
  const recentSales = selectedService ? await prisma.order.aggregate({
    where: { status: 'active', branch: { serviceId: selectedService.id }, ...(selectedBranchId ? { branchId: selectedBranchId } : {}), createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    _count: true, _sum: { grandTotal: true },
  }) : null;
  const counterHref = selectedService?.type === 'shop' ? '/admin/materials/counter' : '/admin/retail/counter';
  const catalogHref = selectedService?.type === 'shop' ? '/admin/materials/cement-brands' : '/admin/retail/products';
  const context = selectedService ? `?service=${selectedService.id}${selectedBranchId ? `&branch=${selectedBranchId}` : ''}` : '';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Today</h1>
        <p className="text-sm text-gray-500 mt-1">Your {organization.businessType === 'shop' ? 'building material' : 'retail'} business, as of now.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-4"><p className="text-xs text-gray-500">Business</p><p className="text-lg font-bold mt-1">{organization.businessType === 'shop' ? 'Building Material' : 'General Store'}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Branches</p><p className="text-2xl font-bold mt-1">{branchCount}</p></Card>
        <Card className="p-4"><p className="text-xs text-gray-500">Staff</p><p className="text-2xl font-bold mt-1">{staffCount}</p></Card>
        {recentSales && <Card className="p-4"><p className="text-xs text-gray-500">Sales · last 7 days</p><p className="text-2xl font-bold mt-1">₦{((recentSales._sum.grandTotal || 0) / 100).toLocaleString('en-NG')}</p><p className="text-xs text-gray-500">{recentSales._count} transactions</p></Card>}
        {availableAtcs && <Link href={atcsHref} className="block rounded-lg border bg-white p-4 hover:border-brand-500">
          <p className="text-xs text-gray-500">Available Cement</p>
          <p className="text-2xl font-bold mt-1">{availableBags.toLocaleString()} bags</p>
          <p className="text-xs text-gray-500 mt-1">{availableAtcs.length} open ATC{availableAtcs.length === 1 ? '' : 's'}{brandSummary ? `: ${brandSummary}` : ''}</p>
        </Link>}
      </div>

      {['owner', 'manager', 'materials_manager'].includes(session.user.role) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 text-sm font-medium">
          <Link href="/admin/messages" className="rounded-lg border bg-white p-4 hover:border-brand-500">Chat</Link>
          <Link href="/admin/orders" className="rounded-lg border bg-white p-4 hover:border-brand-500">Orders</Link>
          <Link href="/admin/reports" className="rounded-lg border bg-white p-4 hover:border-brand-500">Transactions</Link>
          <Link href="/admin/messages?announce=1" className="rounded-lg border bg-white p-4 hover:border-brand-500">Send Customer Notification</Link>
        </div>
      )}

      <Card className="p-6">
        <h2 className="font-semibold text-gray-900">{organization.businessType === 'shop' ? 'Building material work' : 'General store work'}</h2>
        <p className="mt-1 text-sm text-gray-500">Choose the task you need for this business.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`${counterHref}${context}`} className={btnPrimaryCls}>{organization.businessType === 'shop' ? 'Open cement warehouse' : 'Open retail counter'}</Link>
          <Link href={`${catalogHref}${context}`} className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50">{organization.businessType === 'shop' ? 'Cement brands' : 'Retail products'}</Link>
          {['owner', 'manager', 'materials_manager'].includes(session.user.role) && <Link href="/admin/users" className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50">Manage users</Link>}
        </div>
      </Card>
    </div>
  );
}
