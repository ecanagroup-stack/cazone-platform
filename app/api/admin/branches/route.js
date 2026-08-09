import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { slugify } from '@/lib/format';
import { logAudit } from '@/lib/audit';

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

    let code = slugify(name) || 'branch';
    let suffix = 1;
    // Uniqueness is per-organization (@@unique([organizationId, code])); Branch is tenant-scoped so
    // this lookup is already confined to the current org.
    while (await prisma.branch.findFirst({ where: { code } })) {
      suffix += 1;
      code = `${slugify(name) || 'branch'}-${suffix}`;
    }

    const branch = await prisma.branch.create({ data: { serviceId, name, address: address || null, code } });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'branch.created', entityType: 'Branch', entityId: branch.id, after: { name, serviceId },
    });

    return NextResponse.json({ success: true, data: branch }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
