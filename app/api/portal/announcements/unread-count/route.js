import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'customer' || !session.user.customerId) {
    return NextResponse.json({ error: 'Customer access required' }, { status: 403 });
  }
  const count = await prisma.chatMessage.count({
    where: { customerId: session.user.customerId, broadcastId: { not: null }, fromCustomer: false, isRead: false },
  });
  return NextResponse.json({ success: true, data: { count } });
});
