import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveBranchAccess } from '../lib/branchAccessRules.mjs';

// READ-ONLY. Lists active staff who can currently open nothing: a role that is not organization-wide and
// has no UserBranchAccess rows (lib/branchAccess.js fails closed for them). Before that rule they were
// treated as unrestricted, so these are the legacy accounts an Admin must give a station — Users page,
// "Edit Stations". Nothing is written; run: node scripts/list-users-without-branches.mjs
const prisma = new PrismaClient();
try {
  const users = await prisma.user.findMany({
    where: { isActive: true, organizationId: { not: null }, role: { notIn: ['owner', 'super_admin', 'customer'] } },
    select: { id: true, name: true, role: true, email: true, username: true, phone: true, createdAt: true, organization: { select: { name: true, businessType: true } }, _count: { select: { branchAccess: true } } },
    orderBy: [{ organizationId: 'asc' }, { createdAt: 'asc' }],
  });
  const stranded = users.filter((user) => user._count.branchAccess === 0
    && resolveBranchAccess({ role: user.role, businessType: user.organization?.businessType, branchIds: [] }) !== null);
  for (const user of stranded) {
    console.log([user.organization?.name || '-', user.organization?.businessType || '-', user.role, user.name, user.email || user.username || user.phone || '-', user.createdAt.toISOString().slice(0, 10)].join('\t'));
  }
  console.log(`${stranded.length} active staff account(s) with no station assigned (of ${users.length} checked).`);
} finally {
  await prisma.$disconnect();
}
