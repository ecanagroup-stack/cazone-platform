import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { managerChatBranches, selectedChatBranch } from '@/lib/chatBranches';

// Inbox — every customer this staff member can message, most recent activity first. Only customers
// with portal access enabled are listed: without a login (Customer.userId), a customer has no way to
// ever see a reply, so starting a thread with one would be a dead end.
export const GET = withOrg(async (request) => {
  const session = await getOrgSession();
  if (!can(session.user.role, 'chat.manage')) {
    return NextResponse.json({ error: 'You do not have permission to view messages' }, { status: 403 });
  }
  const branches = await managerChatBranches(session);
  const requestedBranchId = new URL(request.url).searchParams.get('branchId');
  let branch;
  try { branch = selectedChatBranch(branches, requestedBranchId); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 403 }); }
  if (!branch) return NextResponse.json({ success: true, data: { branches, branchId: null, conversations: [] } });
  const customers = await prisma.customer.findMany({
    where: {
      userId: { not: null },
      isActive: true,
      user: { isActive: true },
      access: { some: { branchId: branch.id } },
    },
    select: { id: true, name: true, businessName: true, phone: true },
  });
  const customerIds = customers.map((c) => c.id);

  const [lastMessages, unreadGroups] = customerIds.length === 0 ? [[], []] : await Promise.all([
    prisma.chatMessage.findMany({
      where: { customerId: { in: customerIds }, branchId: branch.id },
      orderBy: { createdAt: 'desc' },
      distinct: ['customerId'],
    }),
    prisma.chatMessage.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, branchId: branch.id, fromCustomer: true, isRead: false },
      _count: { _all: true },
    }),
  ]);

  const lastByCustomer = new Map(lastMessages.map((m) => [m.customerId, m]));
  const unreadByCustomer = new Map(unreadGroups.map((g) => [g.customerId, g._count._all]));

  const conversations = customers.map((c) => ({
    customer: c,
    lastMessage: lastByCustomer.get(c.id) || null,
    unreadCount: unreadByCustomer.get(c.id) || 0,
  }));

  conversations.sort((a, b) => {
    const at = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bt = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    if (at !== bt) return bt - at;
    return a.customer.name.localeCompare(b.customer.name);
  });

  return NextResponse.json({ success: true, data: { branches, branchId: branch.id, conversations } });
});
