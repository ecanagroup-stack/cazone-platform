import prisma from './prisma';
import { runWithOrg } from './tenantScope';
import { isValidServiceType, serviceLabel } from './services';
import { slugify } from './format';
import { logAudit } from './audit';
import { ApiError } from './apiError';

// Actually creates the Service/Branch for an already-quoted ProvisioningRequest, scoped to the
// requesting org via runWithOrg (the caller — a platform operator or the Paystack webhook — isn't
// itself tenant-scoped). Extracted so the manual super_admin "Approve & Provision" action
// (app/api/platform/organizations/[id]/provisioning-requests/[requestId]/route.js) and a confirmed
// Paystack payment (app/api/webhooks/paystack/route.js) run the identical transaction instead of two
// copies drifting apart. `decidedBy` is null when triggered automatically by a payment, not a person.
export async function provisionRequest(requestId, { decidedBy, decidedByName, note } = {}) {
  const reqRow = await prisma.provisioningRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new ApiError('Request not found', 404);
  if (reqRow.status === 'approved' || reqRow.status === 'rejected') throw new ApiError('This request has already been decided', 400);

  let created;
  await runWithOrg(reqRow.organizationId, async () => {
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
    where: { id: requestId }, data: { status: 'approved', decisionNote: note || null, decidedBy: decidedBy || null, decidedAt: new Date() },
  });

  // AuditLog.actorUserId/actorName are required (append-only trail, always attributable to
  // something) — a payment-triggered provision has no human actor, so it's attributed to a fixed
  // system identity rather than left null.
  await logAudit({
    organizationId: reqRow.organizationId,
    actorUserId: decidedBy || 'system:paystack', actorName: decidedBy ? (decidedByName || 'Platform operator') : 'Paystack payment',
    action: 'provisioning_request.approved', entityType: 'ProvisioningRequest', entityId: requestId,
    before: { status: reqRow.status }, after: { status: 'approved', ...created },
  });

  return updated;
}
