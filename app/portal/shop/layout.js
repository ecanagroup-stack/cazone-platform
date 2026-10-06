import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';

export default async function PortalShopLayout({ children }) {
  const session = await getOrgSession();
  if (session?.user?.role !== 'customer' || !session.user.organizationId) notFound();
  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId }, select: { businessType: true },
  });
  if (org?.businessType !== 'shop') notFound();
  return children;
}
