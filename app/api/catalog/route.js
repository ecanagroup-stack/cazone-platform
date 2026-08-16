import { NextResponse } from 'next/server';
import { getServiceCatalog } from '@/lib/services';

// Public — signup needs the available catalog before any session exists, and the in-app "add
// another service" picker (app/admin/services/page.js) reuses the same endpoint rather than
// duplicating it behind auth.
export async function GET() {
  const catalog = await getServiceCatalog({ availableOnly: true });
  return NextResponse.json({ success: true, data: catalog });
}
