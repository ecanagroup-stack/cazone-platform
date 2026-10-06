import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { logAudit } from '@/lib/audit';

export const GET = withOrg(async (request, { params }) => {
  try {
    const { id } = await params;
    const branch = await prisma.branch.findUnique({ where: { id }, include: { service: { select: { type: true, isActive: true } } } });
    if (!branch) throw new ApiError('Branch not found', 404);
    const session = await getOrgSession();
    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (!branch.service.isActive || branch.service.type !== org.businessType) throw new ApiError('Branch not found', 404);
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
    let toleranceChange = null;
    const current = await prisma.branch.findUnique({ where: { id }, include: { service: { select: { type: true, isActive: true } } } });
    if (!current) throw new ApiError('Branch not found', 404);
    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (!current.service.isActive || current.service.type !== org.businessType) throw new ApiError('Branch not found', 404);
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
      if (current.service.type === 'fuel_station' && body.config.reconciliationTolerancePct !== undefined &&
          Number(body.config.reconciliationTolerancePct) !== Number(current.config?.reconciliationTolerancePct ?? 0.5)) {
        const reason = String(body.editReason || '').trim();
        if (reason.length < 5) throw new ApiError('Provide a reason for the station change (at least 5 characters)', 400);
        toleranceChange = { before: current.config?.reconciliationTolerancePct ?? 0.5,
          after: Number(body.config.reconciliationTolerancePct), reason };
      }
      update.config = { ...(current.config || {}), ...body.config };
    }

    const fuelDetailsChanged = current.service.type === 'fuel_station' &&
      ['isActive', 'name', 'address'].some((key) => update[key] !== undefined && update[key] !== current[key]);
    if (fuelDetailsChanged && String(body.editReason || '').trim().length < 5) {
      throw new ApiError('Provide a reason for the station change (at least 5 characters)', 400);
    }

    const updated = await prisma.branch.update({ where: { id }, data: update });
    if (toleranceChange || fuelDetailsChanged) await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'fuel.station.updated', entityType: 'Branch', entityId: id,
      before: { name: current.name, address: current.address, isActive: current.isActive, reconciliationTolerancePct: current.config?.reconciliationTolerancePct ?? 0.5 },
      after: { name: updated.name, address: updated.address, isActive: updated.isActive,
        reconciliationTolerancePct: updated.config?.reconciliationTolerancePct ?? 0.5, reason: String(body.editReason).trim() },
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
