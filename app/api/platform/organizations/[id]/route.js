import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

const VALID_STATUSES = ['trialing', 'active', 'past_due', 'canceled'];

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

export async function GET(request, { params }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const data = await runUnscoped(async () => {
      const org = await prisma.organization.findUnique({
        where: { id },
        include: {
          users: { where: { role: { not: 'customer' } }, orderBy: { createdAt: 'asc' } },
          services: { include: { branches: true } },
        },
      });
      if (!org) throw new ApiError('Not found', 404);
      return org;
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}

export async function PUT(request, { params }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();

    const update = {};
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.phone === 'string') update.phone = body.phone.trim() || null;
    if (typeof body.email === 'string') update.email = body.email.trim().toLowerCase() || null;
    if (typeof body.currency === 'string' && body.currency.trim()) update.currency = body.currency.trim().toUpperCase();
    if (body.subscriptionStatus !== undefined) {
      if (!VALID_STATUSES.includes(body.subscriptionStatus)) throw new ApiError('Invalid subscription status', 400);
      update.subscriptionStatus = body.subscriptionStatus;
    }
    if (body.trialEndsAt !== undefined) update.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
    if (typeof body.freeForever === 'boolean') update.freeForever = body.freeForever;
    if (typeof body.isActive === 'boolean') update.isActive = body.isActive;
    if (body.monthlyPrice !== undefined) {
      const n = Number(body.monthlyPrice);
      if (!Number.isFinite(n) || n < 0) throw new ApiError('Invalid monthly price', 400);
      update.monthlyPrice = n;
    }

    const result = await runUnscoped(async () => {
      const before = await prisma.organization.findUnique({ where: { id } });
      if (!before) throw new ApiError('Not found', 404);
      const updated = await prisma.organization.update({ where: { id }, data: update });

      await logAudit({
        organizationId: id,
        actorUserId: session.user.id,
        actorName: session.user.name,
        action: 'organization.updated',
        entityType: 'Organization',
        entityId: id,
        before: { subscriptionStatus: before.subscriptionStatus, isActive: before.isActive, freeForever: before.freeForever, name: before.name, phone: before.phone, email: before.email },
        after: { subscriptionStatus: updated.subscriptionStatus, isActive: updated.isActive, freeForever: updated.freeForever, name: updated.name, phone: updated.phone, email: updated.email },
      });

      return updated;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
