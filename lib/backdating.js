import { verifyOtp } from './otp';
import { notifyAlteration } from './notify';
import { isBackdated } from './saleDates.mjs';
import { ApiError } from './apiError';

// Past dates are allowed but need their own code (purpose `backdated_entry`), separate from any
// other OTP the action takes. Call after all other validation and before the writes, like any
// verifyOtp. Returns whether the date was back-dated, so the caller knows to notify afterwards.
// A missing date means "today" (the writer left it blank), so there is nothing to verify.
export async function requireBackdateOtp({ userId, date, otp }) {
  if (!date || !isBackdated(date)) return false;
  await verifyOtp({ userId, purpose: 'backdated_entry', code: otp });
  return true;
}

// The code field is optional in the form, so a blank one is the commonest failure. Call this next to the
// other validation, before any code is spent, so that miss does not burn a different single-use code.
export function assertBackdateOtpPresent(date, otp) {
  if (date && isBackdated(date) && !otp) throw new ApiError('Enter the verification code for the back-dated entry', 400);
}

// For routes that already send a notice for the action: when the entry is back-dated, send that same
// notice marked as back-dated instead of a second one (type `backdated_entry`, so it can be filtered).
export function backdatedNotice(notice, date) {
  const day = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  return { ...notice, type: 'backdated_entry', title: `${notice.title} (back-dated)`, message: `${notice.message} Dated ${day}.` };
}

// `what` completes "<actor> recorded ..." (e.g. "payment PAY-12 of ₦5,000"); call after the write commits.
export async function notifyBackdated({ actor, branchId, branchIds, what, date, relatedType, relatedId }) {
  const day = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  await notifyAlteration({
    actor, branchId, branchIds, type: 'backdated_entry', title: 'Back-dated entry',
    message: `${actor.name} recorded ${what} dated ${day}.`, relatedType, relatedId,
  });
}
