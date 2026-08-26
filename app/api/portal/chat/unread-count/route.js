import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

// Cheap poll target for the portal nav badge, with no side effect (unlike GET /api/portal/chat,
// which marks messages read — a nav-wide badge poll must not silently mark things read before the
// customer has actually opened the thread).
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (!session.user.customerId) return NextResponse.json({ success: true, data: { count: 0 } });

  const count = await prisma.chatMessage.count({
    where: { customerId: session.user.customerId, fromCustomer: false, isRead: false },
  });
  return NextResponse.json({ success: true, data: { count } });
});
