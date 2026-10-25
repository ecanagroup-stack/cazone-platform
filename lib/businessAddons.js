import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/apiError';

export const BUSINESS_ADDONS = {
  shop: {
    label: 'Additional shop',
    allowedFor: ['shop'],
    requiresBranch: true,
  },
  petrol_station: {
    label: 'Additional petrol station',
    allowedFor: ['fuel_station'],
    requiresBranch: true,
  },
  distributor: {
    label: 'Petroleum distributor',
    allowedFor: ['fuel_station'],
    requiresBranch: false,
  },
};

export function getBusinessAddon(type) {
  return BUSINESS_ADDONS[type] || null;
}

export function assertAddonAllowed(businessType, addonType) {
  const addon = getBusinessAddon(addonType);
  if (!addon) throw new ApiError('Invalid business add-on', 400);
  if (!addon.allowedFor.includes(businessType)) {
    throw new ApiError(`The ${addon.label.toLowerCase()} add-on is not available for this business`, 400);
  }
  return addon;
}

// Types of the add-ons that are switched on for this organization right now. BusinessAddon is not
// tenant-scoped, so the organizationId filter is the only thing keeping orgs apart.
export async function activeAddonTypes(organizationId) {
  const rows = await prisma.businessAddon.findMany({ where: { organizationId, status: 'active' }, select: { type: true, endsAt: true } });
  const now = new Date();
  return [...new Set(rows.filter((row) => !row.endsAt || row.endsAt > now).map((row) => row.type))];
}
