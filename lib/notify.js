import prisma from './prisma';
import { ALTERATION_CANDIDATE_ROLES, alterationRecipients } from './notifyRecipients.mjs';

// Best-effort, in-app only — wrapped so a notification failure never breaks the action that
// triggered it (same defensive pattern as the old apps' createNotification). Called after the
// triggering transaction has already committed, not from inside it — a failed notify() must never
// roll back a real business action.
export async function notify({ recipientUserId, recipientRole, title, message, type, relatedType, relatedId }) {
  try {
    await prisma.notification.create({
      data: { recipientUserId: recipientUserId || null, recipientRole: recipientRole || null, title, message, type, relatedType: relatedType || null, relatedId: relatedId || null },
    });
  } catch (e) {
    console.error('notify() failed', e);
  }
}

// One notification per active user holding any of `roles`. Role-addressed rows (recipientRole) share
// one read state across everyone with the role, so work that someone must act on (a sold ATC) goes to
// each person individually instead.
export async function notifyRoleUsers(roles, { exceptUserId, title, message, type, relatedType, relatedId }) {
  try {
    const users = await prisma.user.findMany({ where: { role: { in: roles }, isActive: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { id: true } });
    await Promise.all(users.map((user) => notify({ recipientUserId: user.id, title, message, type, relatedType, relatedId })));
  } catch (error) {
    console.error('notifyRoleUsers() failed', error);
  }
}

// Tells the oversight roles that someone altered money, stock or a price — who exactly depends on
// the actor (see lib/notifyRecipients.mjs), plus the manager of the affected branch. One row per
// recipient so one person reading it does not mark it read for everyone. `actor` is the session user
// ({ id, role }); `branchId` is the branch the change happened in, when there is one, or `branchIds`
// for a customer-level change (see customerBranchIds).
export async function notifyAlteration({ actor, branchId, branchIds, title, message, type, relatedType, relatedId }) {
  try {
    const candidates = await prisma.user.findMany({
      where: { role: { in: ALTERATION_CANDIDATE_ROLES }, isActive: true },
      select: { id: true, role: true, isActive: true, branchAccess: { select: { branchId: true } } },
    });
    const users = candidates.map((user) => ({ ...user, branchIds: user.branchAccess.map((access) => access.branchId) }));
    const recipientIds = alterationRecipients({ actor, branchId, branchIds, users });
    await Promise.all(recipientIds.map((recipientUserId) => notify({ recipientUserId, title, message, type, relatedType, relatedId })));
  } catch (error) {
    console.error('notifyAlteration() failed', error);
  }
}

// The branches a customer account belongs to — for notifying those branches' managers about a
// change that is on the customer rather than on one branch's sale. Caller has already confirmed the
// customer is in the current organization (CustomerAccess has no organizationId of its own).
export async function customerBranchIds(customerId) {
  try {
    const access = await prisma.customerAccess.findMany({ where: { customerId }, select: { branchId: true } });
    return access.map((a) => a.branchId);
  } catch (error) {
    console.error('customerBranchIds() failed', error);
    return [];
  }
}
