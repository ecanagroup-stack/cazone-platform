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
