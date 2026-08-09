import { NextResponse } from 'next/server';
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

// Manual extension for a subscriber who paid outside Paystack (bank transfer, cash, etc) — same
// escape hatch ecana_shop-app already relies on since live Paystack wiring is deferred here too.
// Extends from whichever is later: today, or the org's current paid-through date.
export async function POST(request, { params }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    const days = body.plan === 'yearly' ? 365 : 30;

    const result = await runUnscoped(async () => {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org) throw new ApiError('Not found', 404);

      const base = org.subscriptionEndsAt && org.subscriptionEndsAt > new Date() ? org.subscriptionEndsAt : new Date();
      const subscriptionEndsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
      const updated = await prisma.organization.update({
        where: { id },
        data: { subscriptionEndsAt, subscriptionStatus: 'active' },
      });

      await logAudit({
        organizationId: id, actorUserId: session.user.id, actorName: session.user.name,
        action: 'organization.subscription_extended', entityType: 'Organization', entityId: id,
        before: { subscriptionEndsAt: org.subscriptionEndsAt }, after: { subscriptionEndsAt },
      });

      return updated;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
