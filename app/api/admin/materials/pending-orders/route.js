import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';

// Self-service portal orders (app/api/portal/shop/orders) waiting for staff to confirm or reject —
// see lib/sale.js createPendingOrder/confirmPendingOrder for why they don't touch stock/credit yet.
export const GET = withOrg(async () => {
  const orders = await prisma.order.findMany({
    where: { status: 'pending' },
    include: { lines: { include: { product: true } }, customer: true, branch: true },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ success: true, data: orders });
});
