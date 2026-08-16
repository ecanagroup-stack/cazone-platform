import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { runUnscoped } from './tenantScope';
import { ApiError } from './apiError';

export async function hashActionPin(pin) {
  return bcrypt.hash(pin, 10);
}

// A second, short signature separate from the login password — gates the highest-stakes actions
// (credit-limit overrides, price approvals) so they need something typed fresh at the moment, not
// just an already-open session. Ported from the old shop app's User.actionPin concept; the schema
// field (User.actionPinHash) already existed here, unused, before this.
export async function verifyActionPin(userId, pin) {
  if (!pin) throw new ApiError('An action PIN is required for this', 400);
  const user = await runUnscoped(() => prisma.user.findUnique({ where: { id: userId } }));
  if (!user?.actionPinHash) throw new ApiError('Set your action PIN first, from Users', 400);
  const ok = await bcrypt.compare(pin, user.actionPinHash);
  if (!ok) throw new ApiError('Incorrect action PIN', 400);
}
