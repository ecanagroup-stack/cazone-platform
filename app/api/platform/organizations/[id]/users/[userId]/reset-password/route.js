import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

export async function POST(request, { params }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, userId } = await params;
    const body = await request.json();
    const newPassword = body.newPassword || '';
    if (newPassword.length < 8) throw new ApiError('Password must be at least 8 characters', 400);

    const result = await runUnscoped(async () => {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.organizationId !== id) throw new ApiError('Not found', 404);

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

      await logAudit({
        organizationId: id, actorUserId: session.user.id, actorName: session.user.name,
        action: 'user.password_reset_by_platform', entityType: 'User', entityId: userId,
      });

      return { ok: true };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
