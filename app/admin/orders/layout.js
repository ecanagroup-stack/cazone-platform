import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getOrgSession } from '@/lib/session';

export default async function OrdersLayout({ children }) {
  const session = await getOrgSession();
  if (!session?.user?.organizationId) notFound();
  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId }, select: { businessType: true },
  });
  if (!['shop', 'general_store'].includes(org?.businessType)) notFound();
  return children;
}
