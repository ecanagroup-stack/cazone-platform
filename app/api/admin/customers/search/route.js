import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg } from '@/lib/session';

// Small, scoped customer lookup shared by any pack's sale-recording picker (materials counter, fuel
// credit fills) — not the full customer-management screen. Core, not pack-specific, same as
// Customer/Deliveries elsewhere in this repo.
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
