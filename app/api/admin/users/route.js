import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { classifyIdentifier } from '@/lib/identifier';
import { ApiError } from '@/lib/apiError';
import { invitableRolesForBusiness } from '@/lib/businessRoles';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

// owner is never invited — it's created once at signup/org-creation. super_admin/customer are out of
// scope for this form entirely (platform operator and, in v1, a role with no screens to use yet).
// supervisor/cashier/auditor are fuel's review-chain tier, materials_manager/atc_manager are
// Building Material's (lib/permissions.js) — all available like any other staff-side role.
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (!can(session?.user?.role, 'users.invite')) {
    return NextResponse.json({ error: 'You do not have permission to view users' }, { status: 403 });
  }
  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  const access = org.businessType === 'fuel_station' ? await getAccessibleBranchIds(session) : null;
  const users = await prisma.user.findMany({
    where: { role: { not: 'customer' }, ...(access ? { OR: [{ role: 'owner' }, { branchAccess: { some: { branchId: { in: access } } } }] } : {}) },
    select: { id: true, name: true, role: true, email: true, username: true, phone: true, isActive: true,
      branchAccess: { where: { branch: { service: { type: org.businessType } } }, select: { branch: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ success: true, data: users, accessibleBranchIds: access });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'users.invite')) {
    return NextResponse.json({ error: 'You do not have permission to add users' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    const identifier = (body.identifier || '').trim();
    const role = body.role;
    const password = body.password || '';
    const branchIds = Array.isArray(body.branchIds) ? body.branchIds : [];

    if (!name || !identifier || !role || !password) throw new ApiError('Name, login, role and password are all required', 400);
    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (!invitableRolesForBusiness(org?.businessType).includes(role)) throw new ApiError('This role is not available for this business', 400);
    if (password.length < 8) throw new ApiError('Password must be at least 8 characters', 400);
    // Every non-owner role needs at least one branch — a staff member with no branch has nowhere to
    // actually work (petrol-station-app enforces the same: "station required for every non-admin role").
    if (branchIds.length === 0) throw new ApiError('Select at least one branch for this user', 400);
    const selectedBranches = await prisma.branch.findMany({ where: { id: { in: branchIds }, isActive: true, service: { type: org.businessType } }, select: { id: true, service: { select: { type: true, isActive: true, config: true } } } });
    if (selectedBranches.length !== new Set(branchIds).size || selectedBranches.length !== branchIds.length || selectedBranches.some((branch) => !branch.service.isActive && branch.service.config?.migrationStockPending !== true)) throw new ApiError('Select available branches of this business only', 400);
    if (org.businessType === 'fuel_station') {
      const access = await getAccessibleBranchIds(session);
      if (access && branchIds.some((id) => !access.includes(id))) throw new ApiError('You can assign users only to stations you manage', 403);
    }

    const { field: idField, value: idValue } = classifyIdentifier(identifier);

    const existing = await prisma.user.findFirst({ where: { [idField]: idValue } });
    if (existing) throw new ApiError('That login is already taken', 400);

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name, role, passwordHash, [idField]: idValue,
        branchAccess: branchIds.length ? { create: branchIds.map((branchId) => ({ branchId })) } : undefined,
      },
    });

    return NextResponse.json({ success: true, data: { id: user.id, name: user.name, role: user.role } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
