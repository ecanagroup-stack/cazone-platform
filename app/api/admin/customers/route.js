import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const GET = withOrg(async (request) => {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  const customers = await prisma.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { businessName: { contains: q, mode: 'insensitive' } }] }
      : {},
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ success: true, data: customers });
});

// Creating a customer is management, not counter work — an account that can carry a balance is
// worth a manager's attention from the start, per platform-architecture skill §5.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to add customers' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    if (!name) throw new ApiError('Name is required', 400);

    const creditLimit = Math.round(Number(body.creditLimit) || 0);
    if (creditLimit < 0) throw new ApiError('Credit limit cannot be negative', 400);

    const customer = await prisma.customer.create({
      data: {
        name,
        phone: (body.phone || '').trim() || null,
        email: (body.email || '').trim() || null,
        businessName: (body.businessName || '').trim() || null,
        creditLimit,
        createdBy: session.user.id,
      },
    });
    return NextResponse.json({ success: true, data: customer }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
