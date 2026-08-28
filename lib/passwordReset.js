import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { runUnscoped } from './tenantScope';
import { sendPasswordResetEmail } from './email';
import { ApiError } from './apiError';
import { logAudit } from './audit';

// Long enough that checking email (which can take a while) doesn't routinely outrun it, unlike
// lib/otp.js's 10-minute window for a code read straight off a screen.
const TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Public "forgot password" entry — deliberately never reveals whether `identifier` matched an
// account, or whether that account has an email on file (same anti-enumeration shape the login
// lookup already has to live with by being unscoped). Only a real match with a real email actually
// gets anything sent; every other case returns just as silently.
export async function requestPasswordReset(identifier) {
  const raw = (identifier || '').trim();
  if (!raw) return;
  const id = raw.toLowerCase();
  const user = await runUnscoped(() =>
    prisma.user.findFirst({ where: { isActive: true, OR: [{ email: id }, { username: id }, { phone: raw }] } })
  );
  if (!user || !user.email) return;

  const token = crypto.randomBytes(32).toString('base64url');
  await runUnscoped(() =>
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
    })
  );

  const base = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
  await sendPasswordResetEmail({ to: user.email, name: user.name, link: `${base}/reset-password?token=${token}` });
}

// The link's landing action — looked up by the token's hash alone (no userId needed in the URL),
// single-use (usedAt) and expiring, same spirit as OtpCode. Works for staff and customer accounts
// alike since both are just User rows (lib/auth.js) — whoever the token belongs to gets their
// password changed, nothing else about the flow differs by role.
export async function resetPasswordWithToken(token, newPassword) {
  if (!token) throw new ApiError('A reset token is required', 400);
  if (!newPassword || newPassword.length < 8) throw new ApiError('Password must be at least 8 characters', 400);

  const record = await runUnscoped(() =>
    prisma.passwordResetToken.findFirst({
      where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } },
    })
  );
  if (!record) throw new ApiError('This reset link is invalid or has expired — request a new one', 400);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const user = await runUnscoped(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      return updated;
    })
  );

  if (user.organizationId) {
    await logAudit({
      organizationId: user.organizationId, actorUserId: user.id, actorName: user.name,
      action: 'user.password_reset_via_link', entityType: 'User', entityId: user.id,
    });
  }
}
