import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { isValidServiceType, serviceLabel } from '@/lib/services';
import { ApiError } from '@/lib/apiError';
import { slugify } from '@/lib/format';
import { logAudit } from '@/lib/audit';

export const GET = withOrg(async () => {
  const services = await prisma.service.findMany({
    include: { branches: { orderBy: { name: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ success: true, data: services });
});

// Enabling a service also creates its first branch in the same step — a service with zero branches
// isn't a useful state to leave an org in.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'services.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage services' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const type = body.type;
    const branchName = (body.branchName || '').trim();
    if (!isValidServiceType(type)) throw new ApiError('Invalid service type', 400);
    if (!branchName) throw new ApiError('Name the first branch for this service', 400);

    const existing = await prisma.service.findFirst({ where: { type } });
    if (existing) throw new ApiError('This service is already enabled', 400);

    const branchCode = slugify(branchName) || 'main';
    const result = await prisma.$transaction(async (tx) => {
      const service = await tx.service.create({ data: { type, name: serviceLabel(type) } });
      const branch = await tx.branch.create({ data: { serviceId: service.id, name: branchName, code: branchCode } });
      return { service, branch };
    });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'service.enabled', entityType: 'Service', entityId: result.service.id, after: { type },
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
