import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  const notifications = await prisma.notification.findMany({
    where: { OR: [{ recipientUserId: session.user.id }, { recipientRole: session.user.role }] },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return NextResponse.json({ success: true, data: notifications });
});

// Marks every currently-unread notification for this user as read — simplest useful action for a
// bell dropdown; no per-notification read state needed yet.
export const PATCH = withOrg(async () => {
  const session = await getOrgSession();
  await prisma.notification.updateMany({
    where: { OR: [{ recipientUserId: session.user.id }, { recipientRole: session.user.role }], isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return NextResponse.json({ success: true });
});
