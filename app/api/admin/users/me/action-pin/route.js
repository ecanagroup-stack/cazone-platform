import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { hashActionPin } from '@/lib/actionPin';
import { ApiError } from '@/lib/apiError';

// Self-service only — a PIN set by anyone but its owner defeats the point of a second signature.
export const POST = withOrg(async (request) => {
  try {
    const session = await getOrgSession();
    const body = await request.json();
    const pin = (body.pin || '').trim();
    if (!/^\d{4,6}$/.test(pin)) throw new ApiError('PIN must be 4-6 digits', 400);

    const actionPinHash = await hashActionPin(pin);
    await prisma.user.update({ where: { id: session.user.id }, data: { actionPinHash } });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
