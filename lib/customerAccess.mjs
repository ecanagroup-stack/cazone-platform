// Which organizations have customers at all. Shops and general stores always do; a fuel station only
// does with an active `distributor` add-on (the ATC module) — a pure fuel org sells at the pump and
// has no customer list, portal, chat or balances. Pure so layouts, session guards and the login can
// share one rule; the add-on rows are read live per request (never put in the JWT) so a lapse takes
// effect immediately.
export function hasActiveDistributorAddon(addons, now = new Date()) {
  return (addons || []).some((addon) =>
    addon.type === 'distributor'
    && addon.status === 'active'
    && (!addon.endsAt || new Date(addon.endsAt) > now));
}

export function orgHasCustomers({ businessType, addons = [], now = new Date() }) {
  if (businessType === 'shop' || businessType === 'general_store') return true;
  return businessType === 'fuel_station' && hasActiveDistributorAddon(addons, now);
}

// Placing goods orders in the portal (cart + pending-order approval) — the shop/retail catalog only.
// Fuel distributor customers order ATCs through their own flow instead.
export function orgHasOrdering({ businessType }) {
  return businessType === 'shop' || businessType === 'general_store';
}
