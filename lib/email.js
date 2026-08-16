import { Resend } from 'resend';
import { ApiError } from './apiError';

// Transactional email via Resend — a REST API, no SMTP config. Inert until configured: same "not
// set up yet" precedent as the existing Paystack fields on Organization, rather than crashing.
// Requires RESEND_API_KEY and a verified sending address (REPORT_EMAIL_FROM) in .env.
export async function sendReportEmail({ to, subject, note, csvFilename, csv }) {
  if (!process.env.RESEND_API_KEY) {
    throw new ApiError('Email isn\'t configured for this deployment yet — ask an admin to set RESEND_API_KEY', 400);
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.REPORT_EMAIL_FROM || 'Cazone Reports <reports@cazone.app>';

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    text: note ? `${note}\n\nSee the attached report.` : 'See the attached report.',
    attachments: [{ filename: csvFilename.endsWith('.csv') ? csvFilename : `${csvFilename}.csv`, content: Buffer.from(csv).toString('base64') }],
  });
  if (error) throw new ApiError(error.message || 'Failed to send email', 502);
}
