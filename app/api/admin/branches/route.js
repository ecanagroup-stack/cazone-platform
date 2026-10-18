import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage branches' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const serviceId = body.serviceId;
    const name = (body.name || '').trim();
    const address = (body.address || '').trim();
    if (!serviceId || !name) throw new ApiError('Service and branch name are required', 400);

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new ApiError('Service not found', 404);
    const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
    if (!service.isActive || service.type !== org.businessType) throw new ApiError('This branch does not belong to the registered business', 403);
    throw new ApiError('Additional locations must be purchased as business add-ons', 400);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
