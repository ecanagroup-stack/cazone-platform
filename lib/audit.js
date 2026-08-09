import prisma from './prisma';
import { runWithOrg } from './tenantScope';

// Append-only audit trail. Always run through runWithOrg so the tenant-scope Prisma extension
// stamps organizationId itself, same as any other tenant-scoped write — callers just supply which
// org the action happened in, not knowledge of the scoping mechanism.
export async function logAudit({ organizationId, actorUserId, actorName, action, entityType, entityId, before, after }) {
  return runWithOrg(organizationId, () =>
    prisma.auditLog.create({
      data: { actorUserId, actorName, action, entityType, entityId, before: before ?? undefined, after: after ?? undefined },
    })
  );
}
