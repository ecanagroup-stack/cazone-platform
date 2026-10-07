import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { managerChatBranches, selectedChatBranch } from '@/lib/chatBranches';

const MAX_BODY_LENGTH = 4000;

// One in-app announcement per portal-enabled customer in the chosen branch. The server resolves
// branch-wide recipients itself and validates selected recipients against CustomerAccess.
export const POST = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'chat.manage')) {
    return NextResponse.json({ error: 'You do not have permission to send broadcasts' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) throw new ApiError('Message cannot be empty', 400);
    if (text.length > MAX_BODY_LENGTH) throw new ApiError('Message is too long', 400);
    if (!body.branchId) throw new ApiError('Choose a branch', 400);
    const branch = selectedChatBranch(await managerChatBranches(session), body.branchId);
    if (!branch?.isActive) throw new ApiError('This branch is unavailable', 409);
    const audience = body.audience === 'branch' ? 'branch' : body.audience === 'selected' ? 'selected' : null;
    if (!audience) throw new ApiError('Choose branch-wide or selected customers', 400);
    const customerIds = audience === 'selected' && Array.isArray(body.customerIds) ? [...new Set(body.customerIds.filter((id) => typeof id === 'string'))] : [];
    if (audience === 'selected' && customerIds.length === 0) throw new ApiError('Pick at least one customer', 400);
    const eligible = await prisma.customer.findMany({
      where: {
        ...(audience === 'selected' ? { id: { in: customerIds } } : {}),
        userId: { not: null },
        isActive: true,
        user: { isActive: true },
        access: { some: { branchId: branch.id } },
      },
      select: { id: true },
    });
    if (eligible.length === 0) throw new ApiError('No customers with active portal access in this branch', 400);
    if (audience === 'selected' && eligible.length !== customerIds.length) throw new ApiError('Some selected customers are unavailable in this branch; refresh the list', 409);

    const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.createMany({
        data: eligible.map((c) => ({
          organizationId: session.user.organizationId, customerId: c.id, branchId: branch.id,
          fromCustomer: false, senderUserId: session.user.id, senderName: session.user.name,
          body: text, broadcastId,
        })),
      });
      await tx.auditLog.create({ data: {
        organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
        action: 'customer_announcement.sent', entityType: 'ChatBroadcast', entityId: broadcastId,
        after: { branchId: branch.id, audience, customerIds: eligible.map((customer) => customer.id), body: text },
      } });
      return created;
    }, { timeout: 30000 });

    return NextResponse.json({ success: true, data: { sentCount: result.count, branchName: branch.name } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
