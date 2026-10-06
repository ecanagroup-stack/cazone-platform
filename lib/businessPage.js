import { notFound } from 'next/navigation';
import prisma from './prisma';
import { getOrgSession } from './session';
import { requireOrg } from './tenantScope';

export async function requireBusinessPage(type) {
  const session = await getOrgSession();
  if (!session?.user?.organizationId) notFound();
  const organizationId = requireOrg(session);
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { businessType: true } });
  if (org?.businessType !== type) notFound();
  const service = await prisma.service.findFirst({ where: { type }, select: { id: true, isActive: true, config: true } });
  if (!service || (!service.isActive && !(type === 'fuel_station' && service.config?.migrationStockPending === true))) notFound();
  return service;
}
