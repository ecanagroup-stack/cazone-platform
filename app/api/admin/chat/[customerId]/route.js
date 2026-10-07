import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ApiError } from '@/lib/apiError';
import { managerChatBranches, selectedChatBranch } from '@/lib/chatBranches';

const MAX_MESSAGES = 200;
const MAX_BODY_LENGTH = 4000;

export const GET = withOrg(async (request, { params }) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'chat.manage')) {
    return NextResponse.json({ error: 'You do not have permission to view messages' }, { status: 403 });
  }
  try {
    const { customerId } = await params;
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, businessName: true, phone: true, userId: true } });
    if (!customer) throw new ApiError('Customer not found', 404);
    const branches = await managerChatBranches(session, customerId);
    const branch = selectedChatBranch(branches, new URL(request.url).searchParams.get('branchId'));
    if (!branch) throw new ApiError('You do not have access to this customer', 403);

    const messages = await prisma.chatMessage.findMany({
      where: { customerId, branchId: branch.id },
      orderBy: { createdAt: 'desc' },
      take: MAX_MESSAGES,
    });
    messages.reverse();
    const earlierMessages = session.user.role === 'owner' ? await prisma.chatMessage.findMany({
      where: { customerId, branchId: null }, orderBy: { createdAt: 'asc' }, take: MAX_MESSAGES,
    }) : [];

    await prisma.chatMessage.updateMany({
      where: { customerId, branchId: branch.id, fromCustomer: true, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    if (earlierMessages.length) await prisma.chatMessage.updateMany({
      where: { customerId, branchId: null, fromCustomer: true, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({ success: true, data: { customer, branches, branchId: branch.id, messages, earlierMessages } });
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
    const input = await request.json();
    if (!input?.branchId) throw new ApiError('Choose a branch before sending', 400);
    const branches = await managerChatBranches(session, customerId);
    const branch = selectedChatBranch(branches, input?.branchId);
    if (!branch) throw new ApiError('You do not have access to this customer', 403);
    if (!branch.isActive) throw new ApiError('This branch is inactive', 409);

    const body = input?.body;
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new ApiError('Message cannot be empty', 400);
    if (text.length > MAX_BODY_LENGTH) throw new ApiError('Message is too long', 400);

    const message = await prisma.chatMessage.create({
      data: { customerId, branchId: branch.id, fromCustomer: false, senderUserId: session.user.id, senderName: session.user.name, body: text },
    });

    return NextResponse.json({ success: true, data: message }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
