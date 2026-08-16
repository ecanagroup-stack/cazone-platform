import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

// Quarry (supplierId) is fixed at creation, same as ecana's edit form (quarry select disabled while
// editing) — only size, price (via .../price), and isActive change afterward.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage aggregate products' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;

    if (typeof body.size === 'string' && body.size.trim()) {
      const existing = await prisma.product.findUnique({ where: { id }, include: { supplier: true } });
      if (!existing) throw new ApiError('Not found', 404);
      update.attributes = { ...existing.attributes, size: body.size.trim() };
      update.name = `${existing.supplier?.name || existing.name} — ${body.size.trim()}`;
    }

    const updated = await prisma.product.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
