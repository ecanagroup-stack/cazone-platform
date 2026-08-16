import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Edit/deactivate — price changes go through .../price (setPrice, approval-gated), never here,
// matching the old app's "Price (use Price button to change)" disabled-field convention.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage cement brands' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.abbreviation === 'string' && body.abbreviation.trim()) update.abbreviation = body.abbreviation.trim().toUpperCase().slice(0, 3);

    if (body.grade !== undefined || body.depot !== undefined || body.bagSize !== undefined) {
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) throw new ApiError('Not found', 404);
      const attributes = { ...existing.attributes };
      if (body.grade !== undefined) attributes.grade = body.grade || undefined;
      if (body.depot !== undefined) attributes.depotName = body.depot || undefined;
      if (body.bagSize !== undefined) attributes.bagSize = Number(body.bagSize) || 50;
      update.attributes = attributes;
    }

    const updated = await prisma.product.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
