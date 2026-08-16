import { Resend } from 'resend';
import { ApiError } from './apiError';

// Transactional email via Resend — a REST API, no SMTP config. Inert until configured: same "not
// set up yet" precedent as the existing Paystack fields on Organization, rather than crashing.
// Requires RESEND_API_KEY and a verified sending address (REPORT_EMAIL_FROM) in .env.
function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new ApiError('Email isn\'t configured for this deployment yet — ask an admin to set RESEND_API_KEY', 400);
  }
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = () => process.env.REPORT_EMAIL_FROM || 'Cazone <noreply@cazone.app>';

export async function sendReportEmail({ to, subject, note, csvFilename, csv }) {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM(),
    to,
    subject,
    text: note ? `${note}\n\nSee the attached report.` : 'See the attached report.',
    attachments: [{ filename: csvFilename.endsWith('.csv') ? csvFilename : `${csvFilename}.csv`, content: Buffer.from(csv).toString('base64') }],
  });
  if (error) throw new ApiError(error.message || 'Failed to send email', 502);
}

const OTP_PURPOSE_LABEL = { credit_override: 'overriding a customer credit limit', price_approval: 'deciding a price change' };

// lib/otp.js's delivery mechanism — a fresh code every time, rather than a pre-set PIN.
export async function sendOtpEmail({ to, code, purpose }) {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM(),
    to,
    subject: `Your verification code: ${code}`,
    text: `Your one-time code for ${OTP_PURPOSE_LABEL[purpose] || 'this action'} is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
  });
  if (error) throw new ApiError(error.message || 'Failed to send OTP email', 502);
}
