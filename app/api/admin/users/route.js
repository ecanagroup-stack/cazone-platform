import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { classifyIdentifier } from '@/lib/identifier';
import { ApiError } from '@/lib/apiError';

// owner is never invited — it's created once at signup/org-creation. super_admin/customer are out of
// scope for this form entirely (platform operator and, in v1, a role with no screens to use yet).
// supervisor/cashier/auditor are fuel's review-chain tier (lib/permissions.js) — invitable like any
// other staff-side role.
const INVITABLE_ROLES = ['manager', 'supervisor', 'cashier', 'auditor', 'staff'];

export const GET = withOrg(async () => {
  const users = await prisma.user.findMany({
    where: { role: { not: 'customer' } },
    include: { branchAccess: { include: { branch: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ success: true, data: users });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'users.invite')) {
    return NextResponse.json({ error: 'You do not have permission to invite users' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    const identifier = (body.identifier || '').trim();
    const role = body.role;
    const password = body.password || '';
    const branchIds = Array.isArray(body.branchIds) ? body.branchIds : [];

    if (!name || !identifier || !role || !password) throw new ApiError('Name, login, role and password are all required', 400);
    if (!INVITABLE_ROLES.includes(role)) throw new ApiError('Invalid role', 400);
    if (password.length < 8) throw new ApiError('Password must be at least 8 characters', 400);

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

    return NextResponse.json({ success: true, data: user }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
