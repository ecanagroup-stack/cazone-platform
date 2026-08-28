import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

// Deactivate, and (owner/manager only) directly set a new password — same "admin can change any
// user's password" capability app/api/admin/customers/[id]/portal-access already gives for a
// customer's portal login, extended to staff. Unlike the self-service .../account/change-password,
// this never needs the old one — matches ecana_shop-app's admin/users edit form ("Reset Password —
// leave blank to keep current") and petrol-station-app's dedicated users/[id]/reset-password route.
// Removing a user never deletes their history (platform-ui skill, section 5) — deactivate only.
export const PATCH = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'users.invite')) {
    return NextResponse.json({ error: 'You do not have permission to manage users' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const update = {};
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (typeof body.newPassword === 'string' && body.newPassword) {
      if (body.newPassword.length < 8) throw new ApiError('Password must be at least 8 characters', 400);
      update.passwordHash = await bcrypt.hash(body.newPassword, 10);
    }
    const updated = await prisma.user.update({ where: { id }, data: update });

    if (update.passwordHash) {
      await logAudit({
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'user.password_reset_by_admin', entityType: 'User', entityId: id,
      });
    }

    return NextResponse.json({ success: true, data: { id: updated.id, isActive: updated.isActive } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
