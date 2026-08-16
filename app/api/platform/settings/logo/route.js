import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

// Cazone's own logo — same upload pattern as app/api/admin/organization/logo/route.js (org logos),
// just against the PlatformSettings singleton instead of an Organization row, and with no
// AuditLog entry (that model requires an organizationId; there's no tenant for a platform-level
// action to attach one to).
export async function POST(request) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') throw new ApiError('No file provided', 400);
    if (!ALLOWED_TYPES.includes(file.type)) throw new ApiError('Logo must be a PNG, JPEG, WEBP, or SVG image', 400);
    if (file.size > MAX_SIZE) throw new ApiError('Logo must be smaller than 2MB', 400);

    const smallFile = formData.get('smallFile');
    const hasSmallFile = smallFile && typeof smallFile !== 'string';

    const before = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });

    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const blob = await put(`platform-logo/${Date.now()}.${ext}`, file, { access: 'public' });

    const update = { logoUrl: blob.url };
    if (hasSmallFile) {
      const smallBlob = await put(`platform-logo/${Date.now()}-sm.png`, smallFile, { access: 'public' });
      update.logoUrlSmall = smallBlob.url;
    }

    await prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      update,
      create: { id: 'singleton', ...update },
    });

    if (before?.logoUrl) await del(before.logoUrl).catch(() => {});
    if (before?.logoUrlSmall) await del(before.logoUrlSmall).catch(() => {});

    return NextResponse.json({ success: true, data: { logoUrl: update.logoUrl, logoUrlSmall: update.logoUrlSmall || null } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
