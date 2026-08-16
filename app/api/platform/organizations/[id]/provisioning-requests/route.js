import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { ApiError } from '@/lib/apiError';

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
    const rows = await runUnscoped(() => prisma.provisioningRequest.findMany({
      where: { organizationId: id },
      include: { service: true },
      orderBy: { createdAt: 'desc' },
    }));
    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
