import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { runUnscoped, runWithOrg } from '@/lib/tenantScope';
import { isValidServiceType, serviceLabel } from '@/lib/services';
import { slugify } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

// Quote a price, approve & provision (creates the Service/Branch in the same step, scoped to the
// requesting org via runWithOrg since the platform operator acting here isn't itself tenant-scoped —
// same escape hatch extend-subscription/route.js already uses), or reject with a reason. Approval is
// the one place a Service/Branch actually gets created for a request — see
// app/api/admin/provisioning-requests/route.js for why the org side can only ever request, not create.
export async function PATCH(request, { params }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id: organizationId, requestId } = await params;
    const body = await request.json();
    const action = body.action; // 'quote' | 'approve' | 'reject'

    const result = await runUnscoped(async () => {
      const reqRow = await prisma.provisioningRequest.findUnique({ where: { id: requestId } });
      if (!reqRow || reqRow.organizationId !== organizationId) throw new ApiError('Request not found', 404);
      if (reqRow.status === 'approved' || reqRow.status === 'rejected') throw new ApiError('This request has already been decided', 400);

      if (action === 'quote') {
        const quotedAmount = Math.round(Number(body.quotedAmount));
        if (!Number.isFinite(quotedAmount) || quotedAmount < 0) throw new ApiError('Invalid quoted amount', 400);
        return prisma.provisioningRequest.update({
          where: { id: requestId }, data: { status: 'quoted', quotedAmount, quotedAt: new Date() },
        });
      }

      if (action === 'reject') {
        return prisma.provisioningRequest.update({
          where: { id: requestId }, data: { status: 'rejected', decisionNote: body.decisionNote || null, decidedBy: session.user.id, decidedAt: new Date() },
        });
      }

      if (action === 'approve') {
        let created;
        await runWithOrg(organizationId, async () => {
          if (reqRow.type === 'service') {
            if (!(await isValidServiceType(reqRow.serviceType))) throw new ApiError('Invalid service type', 400);
            const existing = await prisma.service.findFirst({ where: { type: reqRow.serviceType } });
            if (existing) throw new ApiError('This service is already enabled for this organization', 400);
            const branchCode = slugify(reqRow.branchName) || 'main';
            created = await prisma.$transaction(async (tx) => {
              const service = await tx.service.create({ data: { type: reqRow.serviceType, name: await serviceLabel(reqRow.serviceType) } });
              const branch = await tx.branch.create({ data: { serviceId: service.id, name: reqRow.branchName, code: branchCode } });
              return { service, branch };
            }, { timeout: 15000 });
          } else {
            const service = await prisma.service.findUnique({ where: { id: reqRow.serviceId } });
            if (!service) throw new ApiError('Service no longer exists', 404);
            let branchCode = slugify(reqRow.branchName) || 'branch';
            let suffix = 1;
            while (await prisma.branch.findFirst({ where: { code: branchCode } })) {
              suffix += 1;
              branchCode = `${slugify(reqRow.branchName) || 'branch'}-${suffix}`;
            }
            created = { branch: await prisma.branch.create({ data: { serviceId: reqRow.serviceId, name: reqRow.branchName, code: branchCode } }) };
          }
        });

        const updated = await prisma.provisioningRequest.update({
          where: { id: requestId }, data: { status: 'approved', decisionNote: body.decisionNote || null, decidedBy: session.user.id, decidedAt: new Date() },
        });

        await logAudit({
          organizationId, actorUserId: session.user.id, actorName: session.user.name,
          action: 'provisioning_request.approved', entityType: 'ProvisioningRequest', entityId: requestId,
          before: { status: reqRow.status }, after: { status: 'approved', ...created },
        });

        return updated;
      }

      throw new ApiError('Invalid action', 400);
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
