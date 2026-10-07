import prisma from './prisma';
import { getAccessibleBranchIds } from './branchAccess';
import { ApiError } from './apiError';

export async function managerChatBranches(session, customerId) {
  const accessibleIds = await getAccessibleBranchIds(session);
  const organization = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  const branches = await prisma.branch.findMany({
    where: {
      service: { type: organization.businessType },
      ...(accessibleIds === null ? {} : { id: { in: accessibleIds } }),
      ...(customerId ? { customerAccess: { some: { customerId } } } : {}),
    },
    select: { id: true, name: true, isActive: true, service: { select: { isActive: true } } },
    orderBy: { name: 'asc' },
  });
  return branches.map(({ service, ...branch }) => ({ ...branch, isActive: branch.isActive && service.isActive }));
}

export async function customerChatBranches(customerId, organizationId) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { businessType: true } });
  const access = await prisma.customerAccess.findMany({
    where: { customerId, branch: { service: { type: organization.businessType } } },
    include: { branch: { select: { id: true, name: true, isActive: true, service: { select: { isActive: true } } } } },
  });
  return access.map(({ branch: { service, ...branch } }) => ({ ...branch, isActive: branch.isActive && service.isActive }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function selectedChatBranch(branches, requestedId) {
  if (requestedId && !branches.some((branch) => branch.id === requestedId)) {
    throw new ApiError('You do not have access to that branch conversation', 403);
  }
  return branches.find((branch) => branch.id === requestedId) || branches.find((branch) => branch.isActive) || branches[0] || null;
}
