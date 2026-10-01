import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { getAccessibleBranchIds, canAccessBranch } from '@/lib/branchAccess';
import { ApiError } from '@/lib/apiError';

const AUDITOR_ROLES = new Set(['auditor', 'daily_auditor', 'external_auditor']);
const CLASSIFICATIONS = new Set(['observation', 'concern', 'issue', 'recommendation']);

// Auditor notes use the shared Flag queue so managers can acknowledge them with a reason.
// The operating date is the target ID; individual pump/tank evidence remains in Day Detail.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!AUDITOR_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: 'Only an auditor can enter a fuel audit comment' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const branchId = body.branchId;
    const date = body.date;
    const comment = String(body.comment || '').trim();
    const classification = body.classification || 'observation';
    if (!branchId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new ApiError('Branch and operating date are required', 400);
    if (!comment || comment.length > 2000) throw new ApiError('Enter a comment of at most 2,000 characters', 400);
    if (!CLASSIFICATIONS.has(classification)) throw new ApiError('Invalid classification', 400);
    const access = await getAccessibleBranchIds(session);
    if (!canAccessBranch(access, branchId)) throw new ApiError('Access denied to this branch', 403);
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, include: { service: true } });
    if (!branch || branch.service?.type !== 'fuel_station') throw new ApiError('Fuel branch not found', 404);
    const created = await prisma.flag.create({ data: {
      branchId, targetType: 'FuelDay', targetId: date,
      severity: classification === 'issue' ? 'issue' : classification === 'concern' ? 'concern' : 'info',
      classification, reason: comment, raisedBy: session.user.id,
    } });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
});
