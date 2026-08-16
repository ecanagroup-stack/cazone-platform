import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// Ported from ecana_shop-app's app/api/organization/logo/route.js — same validation, same
// org-logos/{orgId}-{timestamp}.{ext} path convention, same "delete the old blob after a successful
// swap" behavior. Owner-only (that app gated this to its 'admin' role, the equivalent here).
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') {
    return NextResponse.json({ error: 'You do not have permission to change organization settings' }, { status: 403 });
  }
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') throw new ApiError('No file provided', 400);
    if (!ALLOWED_TYPES.includes(file.type)) throw new ApiError('Logo must be a PNG, JPEG, WEBP, or SVG image', 400);
    if (file.size > MAX_SIZE) throw new ApiError('Logo must be smaller than 2MB', 400);

    const smallFile = formData.get('smallFile');
    const hasSmallFile = smallFile && typeof smallFile !== 'string';

    const orgId = session.user.organizationId;
    const before = await prisma.organization.findUnique({ where: { id: orgId }, select: { logoUrl: true, logoUrlSmall: true } });
    if (!before) throw new ApiError('Organization not found', 404);

    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const blob = await put(`org-logos/${orgId}-${Date.now()}.${ext}`, file, { access: 'public' });

    const update = { logoUrl: blob.url };
    if (hasSmallFile) {
      const smallBlob = await put(`org-logos/${orgId}-${Date.now()}-sm.png`, smallFile, { access: 'public' });
      update.logoUrlSmall = smallBlob.url;
    }
    await prisma.organization.update({ where: { id: orgId }, data: update });

    if (before.logoUrl) await del(before.logoUrl).catch(() => {});
    if (before.logoUrlSmall) await del(before.logoUrlSmall).catch(() => {});

    await logAudit({
      organizationId: orgId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'organization.logo_updated', entityType: 'Organization', entityId: orgId,
      before: { logoUrl: before.logoUrl, logoUrlSmall: before.logoUrlSmall },
      after: { logoUrl: update.logoUrl, logoUrlSmall: update.logoUrlSmall || null },
    });

    return NextResponse.json({ success: true, data: { logoUrl: update.logoUrl, logoUrlSmall: update.logoUrlSmall || null } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
