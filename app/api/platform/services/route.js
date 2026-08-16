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

// The full catalog (not just `available`) — super_admin needs to see coming_soon/retired rows too.
export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const data = await prisma.serviceCatalog.findMany({ orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ success: true, data });
}

export async function POST(request) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const key = (body.key || '').trim();
    const name = (body.name || '').trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new ApiError('Key must be lowercase snake_case (e.g. fuel_station)', 400);
    if (!name) throw new ApiError('Name is required', 400);
    const status = VALID_STATUSES.includes(body.status) ? body.status : 'coming_soon';
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
    const basePriceMonthly = Number.isFinite(Number(body.basePriceMonthly)) ? Number(body.basePriceMonthly) : 0;

    if (await prisma.serviceCatalog.findUnique({ where: { key } })) {
      throw new ApiError(`"${key}" already exists in the catalog`, 400);
    }

    const data = await prisma.serviceCatalog.create({
      data: { key, name, description: body.description?.trim() || null, status, sortOrder, basePriceMonthly },
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
