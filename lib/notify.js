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
