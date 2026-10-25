import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { ATC_SELECT, atcJson } from '@/lib/distributor';

// The ATC manager has told the driver to collect; marking it delivered frees the truck for its next ATC.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.manage')) return atcJson({ error: 'You do not have permission to mark an ATC delivered' }, { status: 403 });
  try {
    const { id } = await params;
    const existing = await prisma.petroleumAtc.findFirst({ where: { id }, select: { serial: true } });
    if (!existing) throw new ApiError('ATC not found', 404);

    const claimed = await prisma.petroleumAtc.updateMany({
      where: { id, status: 'sold' },
      data: { status: 'delivered', deliveredAt: new Date(), deliveredBy: session.user.id },
    });
    if (claimed.count !== 1) throw new ApiError('This ATC is not awaiting delivery', 409);

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.delivered', entityType: 'PetroleumAtc', entityId: id, after: { serial: existing.serial },
    });
    const atc = await prisma.petroleumAtc.findFirst({ where: { id }, select: ATC_SELECT });
    return atcJson({ success: true, data: atc });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});
