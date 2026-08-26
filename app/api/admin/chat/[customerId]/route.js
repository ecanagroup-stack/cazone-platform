import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds } from '@/lib/branchAccess';
import { ApiError } from '@/lib/apiError';

const MAX_MESSAGES = 200;
const MAX_BODY_LENGTH = 4000;

// Same branch check as app/api/admin/customers/search — a customer not tagged to a branch this staff
// member can reach isn't theirs to message, matching the "branch-scoped" chat visibility chosen for
// this feature (distinct from the org-wide Customers management list).
async function assertCanAccessCustomer(session, customerId) {
  const accessibleBranchIds = await getAccessibleBranchIds(session);
  if (accessibleBranchIds === null) return;
  const access = await prisma.customerAccess.findFirst({ where: { customerId, branchId: { in: accessibleBranchIds } } });
  if (!access) throw new ApiError('You do not have access to this customer', 403);
}

export const GET = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'chat.manage')) {
    return NextResponse.json({ error: 'You do not have permission to view messages' }, { status: 403 });
  }
  try {
    const { customerId } = await params;
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, businessName: true, phone: true, userId: true } });
    if (!customer) throw new ApiError('Customer not found', 404);
    await assertCanAccessCustomer(session, customerId);

    const messages = await prisma.chatMessage.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: MAX_MESSAGES,
    });
    messages.reverse();

    await prisma.chatMessage.updateMany({
      where: { customerId, fromCustomer: true, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({ success: true, data: { customer, messages } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});

export const POST = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'chat.manage')) {
    return NextResponse.json({ error: 'You do not have permission to send messages' }, { status: 403 });
  }
  try {
    const { customerId } = await params;
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, userId: true } });
    if (!customer) throw new ApiError('Customer not found', 404);
    if (!customer.userId) throw new ApiError('This customer does not have portal access enabled', 400);
    await assertCanAccessCustomer(session, customerId);

    const body = (await request.json())?.body;
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new ApiError('Message cannot be empty', 400);
    if (text.length > MAX_BODY_LENGTH) throw new ApiError('Message is too long', 400);

    const message = await prisma.chatMessage.create({
      data: { customerId, fromCustomer: false, senderUserId: session.user.id, senderName: session.user.name, body: text },
    });

    return NextResponse.json({ success: true, data: message }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
