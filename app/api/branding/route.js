import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Public, deliberately — login/signup render Cazone's own logo before any session exists.
// PlatformSettings isn't in TENANT_SCOPED_MODELS, so this reads unscoped without any wrapper.
export async function GET() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
  return NextResponse.json({ success: true, data: { logoUrl: settings?.logoUrl || null, logoUrlSmall: settings?.logoUrlSmall || null } });
}
