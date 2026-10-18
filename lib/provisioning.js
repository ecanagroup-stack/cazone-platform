import prisma from './prisma';
import { runWithOrg } from './tenantScope';
import { isValidServiceType, serviceLabel } from './services';
import { slugify } from './format';
import { logAudit } from './audit';
import { ApiError } from './apiError';
import { assertAddonAllowed } from './businessAddons';

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
      const org = await prisma.organization.findUnique({ where: { id: reqRow.organizationId }, select: { businessType: true } });
      if (reqRow.serviceType !== org?.businessType) throw new ApiError('The registered business type cannot be changed', 400);
      const existing = await prisma.service.findFirst();
      if (existing) throw new ApiError('An organization can choose only one business type', 400);
      const branchCode = slugify(reqRow.branchName) || 'main';
      created = await prisma.$transaction(async (tx) => {
        const service = await tx.service.create({ data: { type: reqRow.serviceType, name: await serviceLabel(reqRow.serviceType), isActive: true, config: {} } });
        const branch = await tx.branch.create({ data: { serviceId: service.id, name: reqRow.branchName, code: branchCode } });
        return { service, branch };
      }, { timeout: 15000 });
    } else if (reqRow.type === 'branch') {
      const service = await prisma.service.findUnique({ where: { id: reqRow.serviceId } });
      if (!service) throw new ApiError('Service no longer exists', 404);
      let branchCode = slugify(reqRow.branchName) || 'branch';
      let suffix = 1;
      while (await prisma.branch.findFirst({ where: { code: branchCode } })) {
        suffix += 1;
        branchCode = `${slugify(reqRow.branchName) || 'branch'}-${suffix}`;
      }
      created = { branch: await prisma.branch.create({ data: { serviceId: reqRow.serviceId, name: reqRow.branchName, code: branchCode } }) };
    } else if (reqRow.type === 'addon') {
      const service = await prisma.service.findUnique({ where: { id: reqRow.serviceId }, select: { id: true, type: true } });
      if (!service) throw new ApiError('Primary business service no longer exists', 404);
      const addon = assertAddonAllowed(service.type, reqRow.addonType);
      if (addon.requiresBranch && !reqRow.branchName) throw new ApiError('The add-on requires a location name', 400);
      const existing = await prisma.businessAddon.findFirst({
        where: { organizationId: reqRow.organizationId, type: reqRow.addonType, status: 'active' },
      });
      if (existing && reqRow.addonType === 'distributor') throw new ApiError('The distributor add-on is already active', 400);
      let branch;
      if (addon.requiresBranch) {
        let branchCode = slugify(reqRow.branchName) || 'addon';
        let suffix = 1;
        while (await prisma.branch.findFirst({ where: { organizationId: reqRow.organizationId, code: branchCode } })) {
          suffix += 1;
          branchCode = `${slugify(reqRow.branchName) || 'addon'}-${suffix}`;
        }
        branch = await prisma.branch.create({
          data: { serviceId: reqRow.serviceId, name: reqRow.branchName, code: branchCode, addonType: reqRow.addonType },
        });
      }
      const entitlement = await prisma.businessAddon.create({
        data: {
          organizationId: reqRow.organizationId,
          type: reqRow.addonType,
          branchId: branch?.id,
          price: reqRow.quotedAmount,
        },
      });
      created = { addon: entitlement, ...(branch ? { branch } : {}) };
    } else {
      throw new ApiError('Invalid provisioning request type', 400);
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
