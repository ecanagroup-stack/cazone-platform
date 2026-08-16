import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { runUnscoped } from '@/lib/tenantScope';
import { ApiError } from '@/lib/apiError';
import { slugify } from '@/lib/format';
import { isValidServiceType, serviceLabel } from '@/lib/services';

const TRIAL_DAYS = 14;

// Public signup — creates Organization + Service + Branch + first `owner` User in one transaction.
// Deliberately asks for four things only (business name, currency, one starting service + its first
// branch name) plus the owner's own login, per the platform-ui skill's onboarding rule — everything
// else is a default changeable later from /admin/services.
export async function POST(request) {
  const body = await request.json();
  const orgName = (body.orgName || '').trim();
  const currency = (body.currency || 'NGN').trim().toUpperCase();
  const serviceType = body.serviceType;
  const branchName = (body.branchName || '').trim();
  const ownerName = (body.ownerName || '').trim();
  const ownerUsername = (body.ownerUsername || '').trim().toLowerCase();
  const ownerPassword = body.ownerPassword || '';

  try {
    if (!orgName || !serviceType || !branchName || !ownerName || !ownerUsername || !ownerPassword) {
      throw new ApiError('All fields are required', 400);
    }
    if (!(await isValidServiceType(serviceType))) throw new ApiError('Choose a valid starting service', 400);
    if (ownerPassword.length < 8) throw new ApiError('Password must be at least 8 characters', 400);

    const slug = slugify(orgName);
    if (!slug) throw new ApiError('Could not derive a valid identifier from the business name', 400);
    const branchCode = slugify(branchName) || 'main';
    const passwordHash = await bcrypt.hash(ownerPassword, 10);

    const result = await runUnscoped(async () => {
      if (await prisma.organization.findUnique({ where: { slug } })) {
        throw new ApiError(`"${orgName}" is already taken — try a slightly different name`, 400);
      }
      if (await prisma.user.findUnique({ where: { username: ownerUsername } })) {
        throw new ApiError(`The username "${ownerUsername}" is already taken`, 400);
      }

      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

      // Explicit organizationId on every create below: we're inside runUnscoped, so the tenant-scope
      // Prisma extension deliberately does NOT auto-stamp it (there is no ambient scope yet — the
      // organization is being created in this very transaction).
      return prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: orgName, slug, currency, subscriptionStatus: 'trialing', trialEndsAt },
        });
        const service = await tx.service.create({
          data: { organizationId: org.id, type: serviceType, name: await serviceLabel(serviceType) },
        });
        const branch = await tx.branch.create({
          data: { organizationId: org.id, serviceId: service.id, name: branchName, code: branchCode },
        });
        const owner = await tx.user.create({
          data: { organizationId: org.id, role: 'owner', name: ownerName, username: ownerUsername, passwordHash },
        });
        return { orgId: org.id, slug: org.slug, ownerId: owner.id, serviceId: service.id, branchId: branch.id };
      }, { timeout: 15000 }); // Neon's per-query latency can push a multi-step transaction past Prisma's 5s default
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
