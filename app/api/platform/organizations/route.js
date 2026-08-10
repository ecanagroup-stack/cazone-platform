import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { ApiError } from '@/lib/apiError';
import { slugify } from '@/lib/format';
import { isValidServiceType, serviceLabel } from '@/lib/services';

const TRIAL_DAYS = 14;

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

// Platform routes are cross-tenant: they deliberately run unscoped (every query spans every org).
// Middleware already gates /api/platform to super_admin; this re-checks for defense in depth.
export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const data = await runUnscoped(async () => {
      const orgs = await prisma.organization.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          _count: { select: { users: true } },
          services: { include: { _count: { select: { branches: true } } } },
        },
      });
      return orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        phone: o.phone,
        email: o.email,
        currency: o.currency,
        subscriptionStatus: o.subscriptionStatus,
        freeForever: o.freeForever,
        trialEndsAt: o.trialEndsAt,
        isActive: o.isActive,
        createdAt: o.createdAt,
        serviceTypes: o.services.map((s) => s.type),
        staffCount: o._count.users,
        branchCount: o.services.reduce((sum, s) => sum + s._count.branches, 0),
      }));
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();

  const orgName = (body.orgName || '').trim();
  const phone = (body.phone || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const currency = (body.currency || 'NGN').trim().toUpperCase();
  const serviceType = body.serviceType;
  const branchName = (body.branchName || '').trim();
  const ownerName = (body.ownerName || '').trim();
  const ownerUsername = (body.ownerUsername || '').trim().toLowerCase();
  const ownerPassword = body.ownerPassword || '';
  const slug = slugify(body.slug || orgName);

  try {
    if (!orgName || !serviceType || !branchName || !ownerName || !ownerUsername || !ownerPassword) {
      throw new ApiError('Business name, starting service, first branch, and the owner login are all required', 400);
    }
    if (!isValidServiceType(serviceType)) throw new ApiError('Choose a valid starting service', 400);
    if (!slug) throw new ApiError('Could not derive a valid slug from the business name', 400);

    const passwordHash = await bcrypt.hash(ownerPassword, 10);
    const branchCode = slugify(branchName) || 'main';

    const result = await runUnscoped(async () => {
      if (await prisma.organization.findUnique({ where: { slug } })) throw new ApiError(`The slug "${slug}" is already taken`, 400);
      if (await prisma.user.findUnique({ where: { username: ownerUsername } })) throw new ApiError(`The username "${ownerUsername}" is already taken`, 400);

      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

      return prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: orgName, slug, phone: phone || null, email: email || null, currency, subscriptionStatus: 'trialing', trialEndsAt, freeForever: false, isActive: true },
        });
        const service = await tx.service.create({
          data: { organizationId: org.id, type: serviceType, name: serviceLabel(serviceType) },
        });
        const branch = await tx.branch.create({
          data: { organizationId: org.id, serviceId: service.id, name: branchName, code: branchCode },
        });
        const owner = await tx.user.create({
          data: { organizationId: org.id, role: 'owner', name: ownerName, username: ownerUsername, passwordHash },
        });
        return { orgId: org.id, ownerId: owner.id, slug: org.slug };
      }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
