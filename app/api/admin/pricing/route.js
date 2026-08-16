import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';

// Defaults to pending proposals (what the owner review screen needs); ?status= for the full log.
export const GET = withOrg(async (request) => {
  const status = new URL(request.url).searchParams.get('status') || 'pending';
  const rows = await prisma.priceHistory.findMany({
    where: status === 'all' ? undefined : { status },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ success: true, data: rows });
});
