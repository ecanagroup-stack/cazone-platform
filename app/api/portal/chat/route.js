import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';
import { customerChatBranches, selectedChatBranch } from '@/lib/chatBranches';

const MAX_MESSAGES = 200;
const MAX_BODY_LENGTH = 4000;

// One thread per customer, scoped entirely by the JWT's customerId (never a client-supplied id) —
// same convention as app/api/portal/me.
export const GET = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);
    const branches = await customerChatBranches(session.user.customerId, session.user.organizationId);
    const branch = selectedChatBranch(branches, new URL(request.url).searchParams.get('branchId'));
    if (!branch) throw new ApiError('No branch is linked to this customer account', 403);

    const [messages, earlierMessages] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { customerId: session.user.customerId, branchId: branch.id },
        orderBy: { createdAt: 'desc' }, take: MAX_MESSAGES,
      }),
      prisma.chatMessage.findMany({
        where: { customerId: session.user.customerId, branchId: null },
        orderBy: { createdAt: 'desc' }, take: MAX_MESSAGES,
      }),
    ]);
    messages.reverse();
    earlierMessages.reverse();

    await prisma.chatMessage.updateMany({
      where: { customerId: session.user.customerId, branchId: branch.id, fromCustomer: false, broadcastId: null, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    if (earlierMessages.length) await prisma.chatMessage.updateMany({
      where: { customerId: session.user.customerId, branchId: null, fromCustomer: false, broadcastId: null, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({ success: true, data: { branches, branchId: branch.id, messages, earlierMessages } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});

export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);

    const input = await request.json();
    if (!input?.branchId) throw new ApiError('Choose a branch before sending', 400);
    const branch = selectedChatBranch(await customerChatBranches(session.user.customerId, session.user.organizationId), input?.branchId);
    if (!branch) throw new ApiError('No branch is linked to this customer account', 403);
    if (!branch.isActive) throw new ApiError('This branch is inactive', 409);
    const body = input?.body;
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new ApiError('Message cannot be empty', 400);
    if (text.length > MAX_BODY_LENGTH) throw new ApiError('Message is too long', 400);

    const message = await prisma.chatMessage.create({
      data: { customerId: session.user.customerId, branchId: branch.id, fromCustomer: true, senderUserId: session.user.id, senderName: session.user.name, body: text },
    });

    return NextResponse.json({ success: true, data: message }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
