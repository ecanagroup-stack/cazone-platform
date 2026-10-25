import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';
import { decryptAtcNumber } from '@/lib/atcSecret';

// The one place the real ATC number leaves the database: only the ATC manager and the Admin, one ATC
// at a time, as an explicit action that is audit-logged (who and which ATC, never the number itself).
// POST rather than GET so it is never prefetched, cached or replayed from history.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!['owner', 'atc_manager'].includes(session?.user?.role)) {
    return NextResponse.json({ error: 'Only the ATC manager and the Admin can view the ATC number' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const atc = await prisma.petroleumAtc.findFirst({ where: { id }, select: { serial: true, atcCipher: true } });
    if (!atc) throw new ApiError('ATC not found', 404);
    const atcNumber = decryptAtcNumber(atc.atcCipher);
    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'petroleum_atc.number_viewed', entityType: 'PetroleumAtc', entityId: id, after: { serial: atc.serial },
    });
    return NextResponse.json({ success: true, data: { serial: atc.serial, atcNumber } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
