import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const GET = withOrg(async () => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json({ success: true, data: suppliers });
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage suppliers' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    if (!name) throw new ApiError('Name is required', 400);

    const supplier = await prisma.supplier.create({
      data: {
        name, type: body.type || null,
        phone: (body.phone || '').trim() || null,
        address: (body.address || '').trim() || null,
      },
    });
    return NextResponse.json({ success: true, data: supplier }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
