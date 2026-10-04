import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage dispensers' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.label === 'string' && body.label.trim()) update.label = body.label.trim();
    const current = await prisma.dispenser.findUnique({ where: { id } });
    if (!current) throw new ApiError('Dispenser not found', 404);
    const changed = Object.entries(update).some(([key, value]) => current[key] !== value);
    const reason = String(body.editReason || '').trim();
    if (changed && reason.length < 5) throw new ApiError('Provide a reason for the dispenser change (at least 5 characters)', 400);
    const updated = await prisma.dispenser.update({ where: { id }, data: update });
    if (changed) await logAudit({ organizationId: session.user.organizationId,
      actorUserId: session.user.id, actorName: session.user.name,
      action: 'fuel.dispenser.updated', entityType: 'Dispenser', entityId: id,
      before: { label: current.label, isActive: current.isActive },
      after: { label: updated.label, isActive: updated.isActive, reason },
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
