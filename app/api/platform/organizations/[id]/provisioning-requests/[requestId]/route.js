import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';
import { runUnscoped } from '@/lib/tenantScope';
import { provisionRequest } from '@/lib/provisioning';
import { ApiError } from '@/lib/apiError';

async function requireSuperAdmin() {
  const session = await getOrgSession();
  if (session?.user?.role !== 'super_admin') return null;
  return session;
}

// Quote a price, approve & provision, or reject with a reason. "Approve" delegates to
// lib/provisioning.js's provisionRequest — the same helper a confirmed Paystack payment calls from
// app/api/webhooks/paystack/route.js, so a manual super_admin approval and an automatic paid
// approval create the Service/Branch through the identical transaction, not two copies.
export async function PATCH(request, { params }) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id: organizationId, requestId } = await params;
    const body = await request.json();
    const action = body.action; // 'quote' | 'approve' | 'reject'

    const result = await runUnscoped(async () => {
      const reqRow = await prisma.provisioningRequest.findUnique({ where: { id: requestId } });
      if (!reqRow || reqRow.organizationId !== organizationId) throw new ApiError('Request not found', 404);
      if (reqRow.status === 'approved' || reqRow.status === 'rejected') throw new ApiError('This request has already been decided', 400);

      if (action === 'quote') {
        const quotedAmount = Math.round(Number(body.quotedAmount));
        if (!Number.isFinite(quotedAmount) || quotedAmount < 0) throw new ApiError('Invalid quoted amount', 400);
        return prisma.provisioningRequest.update({
          where: { id: requestId }, data: { status: 'quoted', quotedAmount, quotedAt: new Date() },
        });
      }

      if (action === 'reject') {
        return prisma.provisioningRequest.update({
          where: { id: requestId }, data: { status: 'rejected', decisionNote: body.decisionNote || null, decidedBy: session.user.id, decidedAt: new Date() },
        });
      }

      if (action === 'approve') {
        return provisionRequest(requestId, { decidedBy: session.user.id, decidedByName: session.user.name, note: body.decisionNote });
      }

      throw new ApiError('Invalid action', 400);
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 400 });
  }
}
