import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { atcJson } from '@/lib/distributor';

// Sold ATCs still waiting for the driver to be sent: the badge on the distributor navigation. Zero
// rather than 403 for a role that cannot see the board, so polling it never errors.
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.view')) return atcJson({ success: true, data: { count: 0 } });
  const count = await prisma.petroleumAtc.count({ where: { status: 'sold' } });
  return atcJson({ success: true, data: { count } });
});
