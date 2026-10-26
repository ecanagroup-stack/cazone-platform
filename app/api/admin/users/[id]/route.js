import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';
import { getAccessibleBranchIds } from '@/lib/branchAccess';
import { mergeAssignedBranches, branchAssignmentError } from '@/lib/branchAccessRules.mjs';

// Deactivate, and (owner/manager only) directly set a new password — same "admin can change any
// user's password" capability app/api/admin/customers/[id]/portal-access already gives for a
// customer's portal login, extended to staff. Unlike the self-service .../account/change-password,
// this never needs the old one — matches ecana_shop-app's admin/users edit form ("Reset Password —
// leave blank to keep current") and petrol-station-app's dedicated users/[id]/reset-password route.
// Removing a user never deletes their history (platform-ui skill, section 5) — deactivate only.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'users.invite')) {
    return NextResponse.json({ error: 'You do not have permission to manage users' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (org.businessType === 'fuel_station' && session.user.role === 'manager') {
      const target = await prisma.user.findFirst({ where: { id }, select: { role: true, branchAccess: { select: { branchId: true } } } });
      if (!target) throw new ApiError('User not found', 404);
      if (['owner', 'manager'].includes(target.role)) throw new ApiError('Only the Admin can manage Admin and manager accounts', 403);
      const access = await getAccessibleBranchIds(session);
      if (access && !target.branchAccess.some(({ branchId }) => access.includes(branchId))) throw new ApiError('This user is outside your stations', 403);
    }
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.newPassword === 'string' && body.newPassword) {
      if (body.newPassword.length < 8) throw new ApiError('Password must be at least 8 characters', 400);
      update.passwordHash = await bcrypt.hash(body.newPassword, 10);
    }
    const assigningBranches = Array.isArray(body.branchIds);
    if (Object.keys(update).length === 0 && !assigningBranches) throw new ApiError('No user change submitted', 400);

    // Replace the user's stations. Unlike the other changes this needs the target's role and current
    // rows, so it is checked here before anything is written.
    let branchChange = null;
    if (assigningBranches) {
      const target = await prisma.user.findFirst({ where: { id }, select: { role: true, branchAccess: { select: { branchId: true } } } });
      if (!target) throw new ApiError('User not found', 404);
      const actorIds = await getAccessibleBranchIds(session);
      // A manager may only touch users already at one of their stations; someone with no station at all
      // is the Admin's to place.
      const existingIds = target.branchAccess.map(({ branchId }) => branchId);
      if (actorIds && !existingIds.some((branchId) => actorIds.includes(branchId))) throw new ApiError('This user is outside your stations', 403);
      if (body.branchIds.some((branchId) => typeof branchId !== 'string')) throw new ApiError('Select valid stations', 400);
      // Stations the user holds that this actor cannot see are never theirs to change (mergeAssignedBranches
      // keeps them), so a stray one in the request is ignored rather than failing the whole save.
      const requestedIds = [...new Set(body.branchIds)].filter((branchId) => !actorIds || actorIds.includes(branchId) || !existingIds.includes(branchId));
      const finalIds = mergeAssignedBranches({ existingIds, requestedIds, actorIds });
      const problem = branchAssignmentError({ actorRole: session.user.role, actorIds, targetRole: target.role, businessType: org.businessType, requestedIds, finalIds });
      if (problem) throw new ApiError(problem.error, problem.status);
      // Stations the user already has are kept as they are; only newly added ones must be live stations
      // of this business (same test as Add User).
      const added = requestedIds.filter((branchId) => !existingIds.includes(branchId));
      if (added.length) {
        const valid = await prisma.branch.findMany({ where: { id: { in: added }, isActive: true, service: { type: org.businessType, isActive: true } }, select: { id: true } });
        if (valid.length !== added.length) throw new ApiError('Select available branches of this business only', 400);
      }
      branchChange = { before: existingIds, after: finalIds };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = Object.keys(update).length ? await tx.user.update({ where: { id }, data: update }) : await tx.user.findUnique({ where: { id } });
      if (branchChange) {
        await tx.userBranchAccess.deleteMany({ where: { userId: id } });
        if (branchChange.after.length) await tx.userBranchAccess.createMany({ data: branchChange.after.map((branchId) => ({ userId: id, branchId })) });
      }
      return row;
    });

    if (branchChange) {
      await logAudit({
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'user.branches_changed', entityType: 'User', entityId: id,
        before: { branchIds: branchChange.before }, after: { branchIds: branchChange.after },
      });
    }

    if (update.passwordHash) {
      await logAudit({
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'user.password_reset_by_admin', entityType: 'User', entityId: id,
      });
    }

    return NextResponse.json({ success: true, data: { id: updated.id, isActive: updated.isActive } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
