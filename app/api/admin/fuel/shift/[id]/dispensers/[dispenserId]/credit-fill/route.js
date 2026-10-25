import { NextResponse } from 'next/server';
import { withOrg } from '@/lib/session';

// Pump credit fills are retired: a fuel org has no customers unless it holds the distributor add-on
// (lib/customerAccess.mjs), and pump sales are cash. Historic credit fills (Orders, MeterReading.creditLitres)
// stay as they were, so the close route still nets them out of old shifts.
export const POST = withOrg(async () => {
  return NextResponse.json({ error: 'Credit fills at the pump are no longer available' }, { status: 410 });
});
