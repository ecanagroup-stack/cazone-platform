import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { ApiError } from '@/lib/apiError';

// The deliberate "share this customer across businesses" action (app/admin/customers/[id]/page.js's
// Businesses section) — never automatic. Only offers/allows branches within the caller's own
// getAccessibleBranchIds, same check the initial registration uses.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to change customer access' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const targetBranchId = body.branchId;
    if (!targetBranchId) throw new ApiError('branchId is required', 400);

    const accessible = await getAccessibleBranchIds(session);
    if (!canAccessBranch(accessible, targetBranchId)) throw new ApiError('You do not have access to that branch', 403);

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new ApiError('Customer not found', 404);

    const access = await prisma.customerAccess.upsert({
      where: { customerId_branchId: { customerId: id, branchId: targetBranchId } },
      update: {},
      create: { customerId: id, branchId: targetBranchId },
    });
    return NextResponse.json({ success: true, data: access }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const DELETE = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to change customer access' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const targetBranchId = new URL(request.url).searchParams.get('branchId');
    if (!targetBranchId) throw new ApiError('branchId is required', 400);

    const accessible = await getAccessibleBranchIds(session);
    if (!canAccessBranch(accessible, targetBranchId)) throw new ApiError('You do not have access to that branch', 403);

    const remaining = await prisma.customerAccess.count({ where: { customerId: id } });
    if (remaining <= 1) throw new ApiError('A customer must stay registered at at least one branch', 400);

    await prisma.customerAccess.delete({ where: { customerId_branchId: { customerId: id, branchId: targetBranchId } } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
