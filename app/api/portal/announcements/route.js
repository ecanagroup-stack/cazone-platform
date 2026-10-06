import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (session.user.role !== 'customer' || !session.user.customerId) {
    return NextResponse.json({ error: 'Customer access required' }, { status: 403 });
  }
  const organization = await prisma.organization.findUnique({ where: { id: session.user.organizationId }, select: { businessType: true } });
  if (organization?.businessType === 'fuel_station') {
    return NextResponse.json({ error: 'Not available for this business' }, { status: 404 });
  }
  const announcements = await prisma.chatMessage.findMany({
    where: { customerId: session.user.customerId, broadcastId: { not: null }, fromCustomer: false },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  await prisma.chatMessage.updateMany({
    where: { id: { in: announcements.map((message) => message.id) }, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return NextResponse.json({ success: true, data: announcements });
});
