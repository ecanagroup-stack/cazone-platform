import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

export const GET = withOrg(async () => {
  const session = await getOrgSession();
  if (session?.user?.role !== 'customer' || !session.user.customerId)
    return NextResponse.json({ error: 'Customer access required' }, { status: 403 });
  const orders = await prisma.order.findMany({
    where: { customerId: session.user.customerId, createdBy: session.user.id, channel: { in: ['shop', 'retail'] } },
    include: { branch: { select: { name: true } }, lines: { include: { product: { select: { name: true, unit: true } } } } },
    orderBy: { createdAt: 'desc' }, take: 20,
  });
  return NextResponse.json({ success: true, data: orders });
});
