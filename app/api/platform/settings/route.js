import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

// General (non-logo) platform settings — currently just the payment-collection fee rate. Logo stays
// on its own route (app/api/platform/settings/logo) since it's a file upload, not JSON.
export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
  return NextResponse.json({ success: true, data: settings });
}

export async function PATCH(request) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const update = {};
    if (body.paymentCollectionFeePercent !== undefined) {
      const pct = Number(body.paymentCollectionFeePercent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ApiError('Fee must be a percentage between 0 and 100', 400);
      update.paymentCollectionFeePercent = pct;
    }
    const updated = await prisma.platformSettings.upsert({ where: { id: 'singleton' }, update, create: { id: 'singleton', ...update } });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
