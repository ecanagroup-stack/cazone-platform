import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

function tempPassword() {
  // Human-typeable, not a full random token — this is read once off a screen and typed in by a
  // customer, not pasted from a password manager.
  return crypto.randomBytes(6).toString('base64url');
}

// Staff-initiated portal login for a Customer (fleet/credit client or shop registered customer) —
// no public self-signup for either pack (matches how Customer records are already staff-created).
// POST enables access (or resets the password / reactivates if already enabled); DELETE revokes it
// without deleting the login's history.
export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage customers' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new ApiError('Customer not found', 404);
    if (!customer.email && !customer.phone) {
      throw new ApiError('Add an email or phone number to this customer before enabling portal login', 400);
    }

    const password = tempPassword();
    const passwordHash = await bcrypt.hash(password, 10);

    if (customer.userId) {
      // Already provisioned — reset the password and make sure the login is active. No runUnscoped
      // needed: withOrg already put us in this org's scope, and the linked User belongs to it.
      const user = await prisma.user.update({ where: { id: customer.userId }, data: { passwordHash, isActive: true } });
      await logAudit({
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'customer.portal_access.reset', entityType: 'Customer', entityId: id,
      });
      return NextResponse.json({ success: true, data: { loginId: user.email || user.phone, password, reset: true } });
    }

    // Login identities are global-unique (lib/auth.js) — check before creating, inside runUnscoped
    // since we don't yet know if this identity collides across tenants.
    const identity = customer.email ? { email: customer.email } : { phone: customer.phone };
    const conflict = await runUnscoped(() => prisma.user.findFirst({ where: identity }));
    if (conflict) throw new ApiError('That email/phone is already in use by another login', 400);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId: session.user.organizationId, role: 'customer', name: customer.name, passwordHash, ...identity },
      });
      const updated = await tx.customer.update({ where: { id }, data: { userId: user.id } });
      return { user, updated };
    });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'customer.portal_access.enabled', entityType: 'Customer', entityId: id,
    });

    return NextResponse.json({ success: true, data: { loginId: result.user.email || result.user.phone, password, reset: false } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});

export const DELETE = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'customers.manage')) {
    return NextResponse.json({ error: 'You do not have permission to manage customers' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new ApiError('Customer not found', 404);
    if (!customer.userId) throw new ApiError('This customer has no portal login', 400);

    await prisma.user.update({ where: { id: customer.userId }, data: { isActive: false } });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'customer.portal_access.revoked', entityType: 'Customer', entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
