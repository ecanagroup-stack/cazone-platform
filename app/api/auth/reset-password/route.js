import { NextResponse } from 'next/server';
import { resetPasswordWithToken } from '@/lib/passwordReset';

// Public — the token itself (from the emailed link) is the credential here, not a session.
export async function POST(request) {
  try {
    const body = await request.json();
    await resetPasswordWithToken(body.token, body.newPassword);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
