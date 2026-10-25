import { notFound } from 'next/navigation';
import prisma from './prisma';
import { getOrgSession } from './session';
import { requireOrg } from './tenantScope';
import { hasActiveDistributor } from './distributor';

export async function requireBusinessPage(type) {
  const session = await getOrgSession();
  if (!session?.user?.organizationId) notFound();
  const organizationId = requireOrg(session);
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { businessType: true } });
  if (org?.businessType !== type) notFound();
  const service = await prisma.service.findFirst({ where: { type }, select: { id: true, isActive: true, config: true } });
  if (!service || !service.isActive) notFound();
  return service;
}

// The Petroleum Distributor pages: a fuel station with its fuel service on AND the add-on active. A
// lapsed add-on 404s the pages here and 403s the API (lib/session.js ADDON_API_PREFIXES).
export async function requireDistributorPage() {
  const service = await requireBusinessPage('fuel_station');
  const session = await getOrgSession();
  if (!(await hasActiveDistributor(session.user.organizationId))) notFound();
  return service;
}
