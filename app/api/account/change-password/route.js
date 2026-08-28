import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

// Self-service password change — identical for every role (owner/manager/staff/customer/
// super_admin), since each is just a User row (lib/auth.js). Always operates on the caller's own
// id, resolved unscoped (lib/tenantScope.js) so it works even for a super_admin session, which
// carries no organizationId for withOrg to scope by. Requires the current password, unlike the
// admin-side reset routes (app/api/admin/users/[id], .../customers/[id]/portal-access,
// .../platform/organizations/[id]/users/[id]/reset-password) which set one directly without it.
export async function POST(request) {
  const session = await getOrgSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';
    if (!currentPassword) throw new ApiError('Enter your current password', 400);
    if (newPassword.length < 8) throw new ApiError('New password must be at least 8 characters', 400);

    const user = await runUnscoped(() => prisma.user.findUnique({ where: { id: session.user.id } }));
    if (!user) throw new ApiError('User not found', 404);

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new ApiError('Current password is incorrect', 400);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await runUnscoped(() => prisma.user.update({ where: { id: user.id }, data: { passwordHash } }));

    if (user.organizationId) {
      await logAudit({
        organizationId: user.organizationId, actorUserId: user.id, actorName: user.name,
        action: 'user.password_changed', entityType: 'User', entityId: user.id,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
