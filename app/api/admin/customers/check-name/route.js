import { NextResponse } from 'next/server';
import { withOrg } from '@/lib/session';
import { findDuplicateCustomerName } from '@/lib/customerName';

// Live "as you type" duplicate check for a customer Name field (components/ui.js's
// CustomerNameField) — same findDuplicateCustomerName the create/rename routes already enforce
// server-side, and the same DB-level @@unique([organizationId, normalizedName]) backs both up
// regardless of whether this ever runs; this just lets staff catch it before submitting instead of
// only from the save error. No `customers.manage` gate — matches .../customers/search, a lookup any
// counter picker can call, not the management screen itself.
export const GET = withOrg(async (request) => {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  const excludeId = searchParams.get('excludeId') || undefined;
  const duplicate = await findDuplicateCustomerName(name, excludeId);
  return NextResponse.json({ success: true, data: { duplicate: duplicate ? { id: duplicate.id, name: duplicate.name } : null } });
});
