import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { ATC_SELECT, atcJson } from '@/lib/distributor';
import { sellableWhere } from '@/lib/petroleumAtc.mjs';

// Takes an unsold ATC off sale (and frees its truck). Anything already sold or held by a customer who
// is paying right now cannot be cancelled here.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'atc.manage')) return atcJson({ error: 'You do not have permission to cancel an ATC' }, { status: 403 });
  try {
    const { id } = await params;
    const body = await request.json();
    const reason = String(body.reason || '').trim();
    if (!reason) throw new ApiError('Give a reason for cancelling this ATC', 400);
    const existing = await prisma.petroleumAtc.findFirst({ where: { id }, select: { serial: true } });
    if (!existing) throw new ApiError('ATC not found', 404);

    const claimed = await prisma.petroleumAtc.updateMany({
      where: { id, ...sellableWhere() },
      data: { status: 'cancelled', reservedUntil: null, reservedByCustomerId: null },
    });
    if (claimed.count !== 1) throw new ApiError('Only an ATC that is still on sale can be cancelled', 409);

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.cancelled', entityType: 'PetroleumAtc', entityId: id, after: { serial: existing.serial, reason },
    });
    const atc = await prisma.petroleumAtc.findFirst({ where: { id }, select: ATC_SELECT });
    return atcJson({ success: true, data: atc });
  } catch (e) {
    return atcJson({ error: e.message }, { status: e.status || 400 });
  }
});
