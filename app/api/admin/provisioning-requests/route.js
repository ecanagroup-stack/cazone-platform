import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { isValidServiceType, serviceLabel } from '@/lib/services';
import { ApiError } from '@/lib/apiError';
import { assertAddonAllowed } from '@/lib/businessAddons';

// Requesting a new service or branch — not creating one directly. An org picks what it runs at
// signup with one branch included; wanting more is a request cazone quotes a price for, same manual
// pay-then-confirm flow subscription renewal already uses. The actual Service/Branch only gets
// created once a platform operator approves & provisions (see
// app/api/platform/organizations/[id]/provisioning-requests/[requestId]/route.js), not here.
export const GET = withOrg(async () => {
  const rows = await prisma.provisioningRequest.findMany({
    include: { service: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ success: true, data: rows });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'services.manage')) {
    return NextResponse.json({ error: 'You do not have permission to request a new service or branch' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const type = body.type; // 'service' | 'branch' | 'addon'
    const note = (body.note || '').trim() || null;
    const branchName = (body.branchName || '').trim();

    if (type === 'service') {
      const serviceType = body.serviceType;
      if (!branchName) throw new ApiError('Name the branch you want', 400);
      if (!(await isValidServiceType(serviceType))) throw new ApiError('Invalid service type', 400);
      const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
      if (serviceType !== org.businessType) throw new ApiError('The registered business type cannot be changed', 400);
      const existing = await prisma.service.findFirst();
      if (existing) throw new ApiError('An organization can choose only one business type', 400);
      const pendingDup = await prisma.provisioningRequest.findFirst({ where: { type: 'service', serviceType, status: { in: ['pending', 'quoted'] } } });
      if (pendingDup) throw new ApiError('A request for this service is already pending', 400);

      const created = await prisma.provisioningRequest.create({
        data: { type: 'service', serviceType, branchName, note, requestedBy: session.user.id },
      });
      return NextResponse.json({ success: true, data: { ...created, serviceLabel: await serviceLabel(serviceType) } }, { status: 201 });
    }

    if (type === 'branch') {
      if (!branchName) throw new ApiError('Name the branch you want', 400);
      throw new ApiError('Additional locations must be requested as paid business add-ons', 400);
    }

    if (type === 'addon') {
      const addonType = body.addonType;
      const org = await prisma.organization.findUnique({
        where: { id: session.user.organizationId },
        select: { businessType: true },
      });
      const addon = assertAddonAllowed(org.businessType, addonType);
      if (addon.requiresBranch && !branchName) throw new ApiError(`Name the ${addon.label.toLowerCase()}`, 400);
      const pendingDup = await prisma.provisioningRequest.findFirst({
        where: {
          organizationId: session.user.organizationId,
          type: 'addon',
          addonType,
          status: { in: ['pending', 'quoted'] },
        },
      });
      if (pendingDup) throw new ApiError('A request for this add-on is already pending', 400);
      if (addonType === 'distributor') {
        const active = await prisma.businessAddon.findFirst({
          where: { organizationId: session.user.organizationId, type: addonType, status: 'active' },
        });
        if (active) throw new ApiError('The distributor add-on is already active', 400);
      }
      const service = await prisma.service.findFirst({
        where: { organizationId: session.user.organizationId, type: org.businessType },
        select: { id: true },
      });
      if (!service) throw new ApiError('Your primary business service is not active', 400);
      const created = await prisma.provisioningRequest.create({
        data: {
          type: 'addon',
          addonType,
          serviceId: service.id,
          branchName: addon.requiresBranch ? branchName : null,
          note,
          requestedBy: session.user.id,
        },
      });
      return NextResponse.json({ success: true, data: created }, { status: 201 });
    }

    throw new ApiError('Invalid request type', 400);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
