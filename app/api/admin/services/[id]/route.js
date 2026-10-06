import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'services.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage services' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const service = await prisma.service.findUnique({ where: { id }, select: { type: true, organizationId: true } });
    if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    const org = await prisma.organization.findUnique({ where: { id: service.organizationId }, select: { businessType: true } });
    if (service.type !== org.businessType) return NextResponse.json({ error: 'The registered business type cannot be changed' }, { status: 403 });
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    const updated = await prisma.service.update({ where: { id }, data: update });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
