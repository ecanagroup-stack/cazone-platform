import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { ApiError } from '@/lib/apiError';

const MAX_MESSAGES = 200;
const MAX_BODY_LENGTH = 4000;

// One thread per customer, scoped entirely by the JWT's customerId (never a client-supplied id) —
// same convention as app/api/portal/me.
export const GET = withOrg(async () => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);

    const messages = await prisma.chatMessage.findMany({
      where: { customerId: session.user.customerId },
      orderBy: { createdAt: 'desc' },
      take: MAX_MESSAGES,
    });
    messages.reverse();

    await prisma.chatMessage.updateMany({
      where: { customerId: session.user.customerId, fromCustomer: false, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({ success: true, data: { messages } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});

export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    if (!session.user.customerId) throw new ApiError('No linked customer account', 403);

    const body = (await request.json())?.body;
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new ApiError('Message cannot be empty', 400);
    if (text.length > MAX_BODY_LENGTH) throw new ApiError('Message is too long', 400);

    const message = await prisma.chatMessage.create({
      data: { customerId: session.user.customerId, fromCustomer: true, senderUserId: session.user.id, senderName: session.user.name, body: text },
    });

    return NextResponse.json({ success: true, data: message }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
