import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ATC_SELECT, atcJson } from '@/lib/distributor';

// The sold board: ATCs a customer has paid for, newest first. `status=sold` (default) is what still
// needs the driver instructed and the delivery marked; `status=delivered` is the history.
export const GET = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.view')) return atcJson({ error: 'You do not have permission to view ATC orders' }, { status: 403 });
  const status = new URL(request.url).searchParams.get('status') === 'delivered' ? 'delivered' : 'sold';
  const orders = await prisma.petroleumAtc.findMany({
    where: { status },
    select: ATC_SELECT,
    orderBy: status === 'sold' ? { soldAt: 'asc' } : { deliveredAt: 'desc' },
    take: status === 'sold' ? 200 : 100,
  });
  return atcJson({ success: true, data: { orders, canDeliver: can(session.user.role, 'atc.manage') } });
});
