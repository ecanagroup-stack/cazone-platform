import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

// Deactivating or renaming a service reaches every station in the business (withOrg refuses all fuel
// station calls once the service is inactive), so a station manager cannot do it: Admin only.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') {
    return NextResponse.json({ error: 'Only the Admin can manage services' }, { status: 403 });
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
