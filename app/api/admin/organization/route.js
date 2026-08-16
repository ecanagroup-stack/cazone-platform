import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { withOrg, getOrgSession } from '@/lib/session';
import { logAudit } from '@/lib/audit';
import { ApiError } from '@/lib/apiError';

// Owner-only self-service edit of the org's own profile — name/address/branding/invoicing/bank
// details plus the OTP contact fields (lib/otp.js). Logo itself goes through
// app/api/admin/organization/logo/route.js (a file upload, not JSON).
const STRING_FIELDS = ['name', 'address', 'invoiceFooter', 'bankName', 'accountNumber', 'accountName', 'phone', 'email'];

export const PATCH = withOrg(async (request) => {
  const session = await getOrgSession();
  if (session.user.role !== 'owner') {
    return NextResponse.json({ error: 'You do not have permission to change organization settings' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const update = {};
    for (const field of STRING_FIELDS) {
      if (typeof body[field] === 'string') update[field] = body[field].trim() || null;
    }
    if (update.name === null) throw new ApiError('Business name is required', 400);
    if (typeof body.otpEmail === 'string') {
      const otpEmail = body.otpEmail.trim();
      if (otpEmail && !/^\S+@\S+\.\S+$/.test(otpEmail)) throw new ApiError('Invalid OTP email', 400);
      update.otpEmail = otpEmail || null;
    }
    if (typeof body.otpPhone === 'string') update.otpPhone = body.otpPhone.trim() || null;

    const before = await prisma.organization.findUnique({ where: { id: session.user.organizationId } });
    const updated = await prisma.organization.update({ where: { id: session.user.organizationId }, data: update });

    await logAudit({
      organizationId: session.user.organizationId, actorUserId: session.user.id, actorName: session.user.name,
      action: 'organization.updated', entityType: 'Organization', entityId: updated.id,
      before: Object.fromEntries(Object.keys(update).map((k) => [k, before[k]])),
      after: Object.fromEntries(Object.keys(update).map((k) => [k, updated[k]])),
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
});
