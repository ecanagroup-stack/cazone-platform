import prisma from './prisma';

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

// Send separate rows so one reviewer reading a notification does not mark it read for everyone.
export async function notifyReviewers({ actorUserId, title, message, type, relatedType, relatedId }) {
  try {
    const reviewers = await prisma.user.findMany({
      where: { role: { in: ['owner', 'materials_manager', 'auditor', 'daily_auditor', 'external_auditor'] }, isActive: true },
      select: { id: true },
    });
    await Promise.all(reviewers.filter((user) => user.id !== actorUserId).map((user) => notify({
      recipientUserId: user.id, title, message, type, relatedType, relatedId,
    })));
  } catch (error) {
    console.error('notifyReviewers() failed', error);
  }
}
