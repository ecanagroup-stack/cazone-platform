import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds } from '@/lib/branchAccess';
import { ApiError } from '@/lib/apiError';

const MAX_BODY_LENGTH = 4000;

// One message to many customers at once — one ChatMessage row per recipient (fromCustomer: false),
// all sharing a broadcastId so the thread UI can label them "Announcement" instead of a direct reply.
// Same owner/manager + branch-scoped access as the rest of chat (app/api/admin/chat/[customerId]):
// every targeted customerId is re-validated against this staff member's accessible branches
// server-side, never trusting the picker to have only offered ones they can actually reach.
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
    const customerIds = Array.isArray(body.customerIds) ? [...new Set(body.customerIds)] : [];
    if (customerIds.length === 0) throw new ApiError('Pick at least one customer', 400);

    const accessibleBranchIds = await getAccessibleBranchIds(session);
    const eligible = await prisma.customer.findMany({
      where: {
        id: { in: customerIds },
        userId: { not: null },
        ...(accessibleBranchIds === null ? {} : { access: { some: { branchId: { in: accessibleBranchIds } } } }),
      },
      select: { id: true },
    });
    if (eligible.length === 0) throw new ApiError('None of the selected customers can be messaged', 400);

    const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await prisma.chatMessage.createMany({
      data: eligible.map((c) => ({
        customerId: c.id, fromCustomer: false, senderUserId: session.user.id, senderName: session.user.name,
        body: text, broadcastId,
      })),
    });

    return NextResponse.json({ success: true, data: { sentCount: result.count, skippedCount: customerIds.length - eligible.length } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
