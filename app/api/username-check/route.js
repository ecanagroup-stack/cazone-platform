import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { runUnscoped } from '@/lib/tenantScope';
import { classifyIdentifier } from '@/lib/identifier';

// Public, deliberately — signup (choosing an owner username, pre-auth) needs this as much as the
// authenticated Invite User form does. Only ever answers "is this taken," nothing else about the
// account that holds it, so there's nothing sensitive to gate behind a session.
//
// Pass `username` to force a username-only check (signup/org-creation forms, where the field is
// always a username regardless of what it looks like), or `identifier` to auto-classify the same
// way app/api/admin/users/route.js does (email vs. phone vs. username) for the combined-field
// Invite User form.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const usernameParam = searchParams.get('username');
  const identifierParam = searchParams.get('identifier');

  let field, value;
  if (usernameParam !== null) {
    field = 'username';
    value = usernameParam.trim().toLowerCase();
  } else if (identifierParam !== null) {
    ({ field, value } = classifyIdentifier(identifierParam));
  } else {
    return NextResponse.json({ error: 'username or identifier is required' }, { status: 400 });
  }

  if (!value) return NextResponse.json({ success: true, data: { available: null, field } });

  const existing = await runUnscoped(() => prisma.user.findFirst({ where: { [field]: value }, select: { id: true } }));
  return NextResponse.json({ success: true, data: { available: !existing, field } });
}
