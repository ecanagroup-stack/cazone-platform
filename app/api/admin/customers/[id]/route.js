import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';
import { buildCustomerStatement } from '@/lib/statement';

export const GET = withOrg(async (request, { params }) => {
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id }, include: { user: { select: { isActive: true } } } });
    if (!customer) throw new ApiError('Customer not found', 404);

    const { ledger, buckets } = await buildCustomerStatement(id);

    return NextResponse.json({ success: true, data: { customer, ledger, buckets } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});

export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to edit customers' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.phone === 'string') update.phone = body.phone.trim() || null;
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.onHold === 'boolean') update.onHold = body.onHold;
    if (body.creditLimit !== undefined) {
      const n = Math.round(Number(body.creditLimit));
      if (!Number.isFinite(n) || n < 0) throw new ApiError('Invalid credit limit', 400);
      update.creditLimit = n;
    }

    const before = await prisma.customer.findUnique({ where: { id } });
    if (!before) throw new ApiError('Customer not found', 404);
    const updated = await prisma.customer.update({ where: { id }, data: update });

    if (update.creditLimit !== undefined || update.onHold !== undefined) {
      await logAudit({
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'customer.updated', entityType: 'Customer', entityId: id,
        before: { creditLimit: before.creditLimit, onHold: before.onHold },
        after: { creditLimit: updated.creditLimit, onHold: updated.onHold },
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
