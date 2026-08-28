import { NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/passwordReset';

// Public — no session required, this IS how a locked-out user gets back in. Always responds success
// (see lib/passwordReset.js's requestPasswordReset) so the response itself can't be used to probe
// which identifiers have accounts.
export async function POST(request) {
  try {
    const body = await request.json();
    await requestPasswordReset(body.identifier);
  } catch (e) {
    // Swallowed toward the caller deliberately — even an unexpected failure here (e.g. email not
    // configured) must not leak anything to an unauthenticated caller beyond "we handled your
    // request." Logged server-side so a misconfiguration (RESEND_API_KEY unset) is still visible
    // to whoever operates this deployment.
    console.error('forgot-password request failed:', e.message);
  }
  return NextResponse.json({ success: true, message: 'If an account exists for that email, username or phone, a reset link has been sent.' });
}
