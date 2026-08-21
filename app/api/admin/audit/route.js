import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';

// Owner-only — "who changed this and when" (platform-architecture skill §5). The tenant-scope
// Prisma extension (lib/prisma.js) already injects organizationId for AuditLog automatically, so
// this where-clause never needs to mention it.
export const GET = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') {
    return NextResponse.json({ error: 'Only the organization owner can view the audit log' }, { status: 403 });
  }
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
    const entityType = url.searchParams.get('entityType') || undefined;
    const action = url.searchParams.get('action') || undefined;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const where = {
      ...(entityType && { entityType }),
      ...(action && { action: { contains: action, mode: 'insensitive' } }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(`${to}T23:59:59.999`) }),
        },
      }),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: { rows, total, page, limit } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
