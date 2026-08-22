import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { ApiError } from '@/lib/apiError';
import { normalizeCreditLimit } from '@/lib/credit';

// The management list — unlike the counter-facing search (app/api/admin/customers/search), this
// shows every customer regardless of branch access when no branchId is given, since an owner/manager
// needs to see the whole org to manage who has access to what. Pass branchId to narrow it.
export const GET = withOrg(async (request) => {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  const branchId = new URL(request.url).searchParams.get('branchId');
  const customers = await prisma.customer.findMany({
    where: {
      ...(branchId ? { access: { some: { branchId } } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { businessName: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    include: { access: { include: { branch: { include: { service: true } } } } },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ success: true, data: customers });
});

// Creating a customer is management, not counter work — an account that can carry a balance is
// worth a manager's attention from the start, per platform-architecture skill §5. Branch-bound by
// default (one CustomerAccess row for the branch they're being registered at); extra `branchIds` lets
// an owner/manager deliberately share them across the other businesses they can see — a branch-scoped
// manager's own accessible-branches list won't include branches to offer in the first place, but this
// re-checks server-side regardless since the client can't be trusted to enforce that on its own.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to add customers' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    const branchId = body.branchId;
    if (!name) throw new ApiError('Name is required', 400);
    if (!branchId) throw new ApiError('A branch is required to register a customer', 400);

    const normalized = normalizeCreditLimit(body.creditLimit);
    const creditLimit = normalized === null ? null : Math.round(normalized);

    const accessible = await getAccessibleBranchIds(session);
    const extraBranchIds = Array.isArray(body.branchIds) ? body.branchIds.filter((id) => id !== branchId) : [];
    const allBranchIds = [branchId, ...extraBranchIds];
    for (const id of allBranchIds) {
      if (!canAccessBranch(accessible, id)) throw new ApiError('You do not have access to one of the selected branches', 403);
    }

    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          name,
          phone: (body.phone || '').trim() || null,
          email: (body.email || '').trim() || null,
          businessName: (body.businessName || '').trim() || null,
          creditLimit,
          createdBy: session.user.id,
          access: { create: allBranchIds.map((id) => ({ branchId: id })) },
        },
        include: { access: true },
      });
      return created;
    });

    return NextResponse.json({ success: true, data: customer }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
