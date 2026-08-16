import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

const VALID_STATUSES = ['available', 'coming_soon', 'retired'];

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

export async function PATCH(request, { params }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { key } = await params;
    const body = await request.json();

    const update = {};
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.description === 'string') update.description = body.description.trim() || null;
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) throw new ApiError('Invalid status', 400);
      update.status = body.status;
    }
    if (body.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      if (!Number.isFinite(n)) throw new ApiError('Invalid sort order', 400);
      update.sortOrder = n;
    }
    if (body.basePriceMonthly !== undefined) {
      const n = Number(body.basePriceMonthly);
      if (!Number.isFinite(n) || n < 0) throw new ApiError('Invalid base price', 400);
      update.basePriceMonthly = n;
    }

    const existing = await prisma.serviceCatalog.findUnique({ where: { key } });
    if (!existing) throw new ApiError('Not found', 404);

    const data = await prisma.serviceCatalog.update({ where: { key }, data: update });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
