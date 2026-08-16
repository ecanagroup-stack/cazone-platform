import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';

export const GET = withOrg(async (request) => {
  try {
    const branchId = new URL(request.url).searchParams.get('branchId');
    if (!branchId) throw new ApiError('branchId is required', 400);
    const attendants = await prisma.attendant.findMany({ where: { branchId }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ success: true, data: attendants });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'branches.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage attendants' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const staffNumber = (body.staffNumber || '').trim();
    const name = (body.name || '').trim();
    if (!branchId || !staffNumber || !name) throw new ApiError('Branch, staff number and name are required', 400);

    const attendant = await prisma.attendant.create({
      data: {
        branchId, staffNumber, name,
        phone: (body.phone || '').trim() || null,
        position: (body.position || '').trim() || null,
        employmentType: (body.employmentType || '').trim() || null,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        gender: (body.gender || '').trim() || null,
        employmentDate: body.employmentDate ? new Date(body.employmentDate) : null,
        photoUrl: (body.photoUrl || '').trim() || null,
      },
    });
    return NextResponse.json({ success: true, data: attendant }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
