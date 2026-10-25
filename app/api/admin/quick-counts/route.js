import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getAccessibleBranchIds } from '@/lib/branchAccess';
import { loadOrgCustomerFlags } from '@/lib/orgLookup';

// One cheap poll for the admin quick-actions strip and sidebar badges: unread customer chats and
// pending portal orders. Same scoping as the chat inbox and pending-orders; zero rather than 403
// so a role without access just shows no badge.
export const GET = withOrg(async () => {
  const session = await getOrgSession();
  const role = session.user.role;
  const { businessType, hasCustomers, hasOrdering } = await loadOrgCustomerFlags(session.user.organizationId);
  const canChat = hasCustomers && can(role, 'chat.manage');
  const canOrders = hasOrdering && can(role, 'sales.record');
  if (!canChat && !canOrders) return NextResponse.json({ success: true, data: { chat: 0, pendingOrders: 0 } });

  const branchIds = await getAccessibleBranchIds(session);
  const branchFilter = branchIds === null ? {} : { branchId: { in: branchIds } };
  const [chat, pendingOrders] = await Promise.all([
    canChat ? prisma.chatMessage.count({ where: { fromCustomer: true, isRead: false, ...branchFilter } }) : 0,
    canOrders ? prisma.order.count({ where: { status: 'pending', branch: { service: { type: businessType } }, ...branchFilter } }) : 0,
  ]);
  return NextResponse.json({ success: true, data: { chat, pendingOrders } });
});
