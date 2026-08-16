import { NextResponse } from 'next/server';
import { withOrg } from '@/lib/session';
import { sendReportEmail } from '@/lib/email';
import { ApiError } from '@/lib/apiError';

// Sharing a report by email isn't a sensitive mutation — any staff role can do it (middleware
// already restricts /api/admin/* to staff roles), no extra permission check needed here.
export const POST = withOrg(async (request) => {
  try {
    const body = await request.json();
    const to = (body.to || '').trim();
    const subject = (body.subject || 'Report').trim();
    const csv = body.csv || '';
    const csvFilename = body.csvFilename || 'report.csv';
    if (!/^\S+@\S+\.\S+$/.test(to)) throw new ApiError('A valid recipient email is required', 400);
    if (!csv) throw new ApiError('Nothing to send', 400);

    await sendReportEmail({ to, subject, note: body.note, csvFilename, csv });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
});
