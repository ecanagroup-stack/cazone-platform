import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';

// Small, scoped lookup for the counter's customer picker — not the full customer-management screen
// (that's a later increment). Returns just enough to show a shortfall check before checkout.
export const GET = withOrg(async (request) => {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json({ success: true, data: [] });

  const customers = await prisma.customer.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { businessName: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 10,
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ success: true, data: customers });
});
