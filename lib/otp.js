import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { sendOtpEmail } from './email';
import { ApiError } from './apiError';

const OTP_TTL_MS = 10 * 60 * 1000;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits, zero-padded by range
}

// Replaces the earlier action-PIN approach for the highest-stakes actions (credit-limit overrides,
// price approvals) — a fresh code sent to the organization's OTP email (Organization.otpEmail,
// falling back to Organization.email) each time, rather than a pre-set secret anyone with the PIN
// could reuse indefinitely.
export async function requestOtp({ organizationId, userId, purpose }) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  const to = org?.otpEmail || org?.email;
  if (!to) throw new ApiError('Set an OTP email for this organization first, from Billing → Security', 400);

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  await prisma.otpCode.create({ data: { userId, purpose, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) } });

  await sendOtpEmail({ to, code, purpose });
}

export async function verifyOtp({ userId, purpose, code }) {
  if (!code) throw new ApiError('A verification code is required for this', 400);
  const otp = await prisma.otpCode.findFirst({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw new ApiError('No active code — send a new one', 400);
  const ok = await bcrypt.compare(code, otp.codeHash);
  if (!ok) throw new ApiError('Incorrect code', 400);
  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
}
