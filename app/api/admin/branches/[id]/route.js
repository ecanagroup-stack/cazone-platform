import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const GET = withOrg(async (request, { params }) => {
  try {
    const { id } = await params;
    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new ApiError('Branch not found', 404);
    return NextResponse.json({ success: true, data: branch });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage branches' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.address === 'string') update.address = body.address.trim() || null;

    // Free-form per-branch settings (e.g. the fuel pack's reconciliation tolerance — F1's
    // Fuel Station Config page) — merged shallowly into Branch.config rather than replaced, so a
    // caller setting one key never clobbers settings another pack put there.
    if (body.config && typeof body.config === 'object') {
      if (body.config.reconciliationTolerancePct !== undefined) {
        const pct = Number(body.config.reconciliationTolerancePct);
        if (!Number.isFinite(pct) || pct <= 0) throw new ApiError('Reconciliation tolerance must be a positive percentage', 400);
      }
      const branch = await prisma.branch.findUnique({ where: { id }, select: { config: true } });
      if (!branch) throw new ApiError('Branch not found', 404);
      update.config = { ...(branch.config || {}), ...body.config };
    }

    const updated = await prisma.branch.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
