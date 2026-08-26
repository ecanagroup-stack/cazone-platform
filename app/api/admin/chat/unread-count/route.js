import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds } from '@/lib/branchAccess';

// Cheap poll target for the Messages sidebar badge — a count, not the full inbox payload.
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'chat.manage')) {
    return NextResponse.json({ success: true, data: { count: 0 } });
  }

  const accessibleBranchIds = await getAccessibleBranchIds(session);
  const count = await prisma.chatMessage.count({
    where: {
      fromCustomer: true,
      isRead: false,
      ...(accessibleBranchIds === null ? {} : { customer: { access: { some: { branchId: { in: accessibleBranchIds } } } } }),
    },
  });
  return NextResponse.json({ success: true, data: { count } });
});
