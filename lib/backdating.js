import { verifyOtp } from './otp';
import { notifyAlteration } from './notify';
import { isBackdated } from './saleDates.mjs';

// Past dates are allowed but need their own code (purpose `backdated_entry`), separate from any
// other OTP the action takes. Call after all other validation and before the writes, like any
// verifyOtp. Returns whether the date was back-dated, so the caller knows to notify afterwards.
export async function requireBackdateOtp({ userId, date, otp }) {
  if (!isBackdated(date)) return false;
  await verifyOtp({ userId, purpose: 'backdated_entry', code: otp });
  return true;
}

// `what` completes "<actor> recorded ..." (e.g. "payment PAY-12 of ₦5,000"); call after the write commits.
export async function notifyBackdated({ actor, branchId, branchIds, what, date, relatedType, relatedId }) {
  const day = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  await notifyAlteration({
    actor, branchId, branchIds, type: 'backdated_entry', title: 'Back-dated entry',
    message: `${actor.name} recorded ${what} dated ${day}.`, relatedType, relatedId,
  });
}
