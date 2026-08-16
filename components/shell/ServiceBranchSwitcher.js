'use client';

import { useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

// A dropdown only when there's an actual choice — same principle TopBar already applies to the org
// name itself ("no user belongs to more than one organization yet, so a dropdown would be
// premature"). Neither proven app shows a persistent picker for a single-service/single-branch
// account: ecana_shop-app has no branch concept at all, and petrol-station-app's station picker is
// an admin-only destination page, never a header widget a single-station manager sees. A
// single-service/single-branch org here now gets the same feel — the only option is auto-selected
// (no click required) and shown as plain text, not a one-item dropdown.
export default function ServiceBranchSwitcher({ services }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';
  const selectedService = services.find((s) => s.id === serviceId);
  const activeService = selectedService || (services.length === 1 ? services[0] : null);

  const setParam = (key, value) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key === 'service') params.delete('branch');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Auto-select the only service/branch a single-option org has, so no page ever shows a "pick a
  // service/branch" empty state just because nobody's clicked a dropdown with one item in it yet.
  useEffect(() => {
    if (!serviceId && services.length === 1) { setParam('service', services[0].id); return; }
    if (activeService && !branchId && activeService.branches.length === 1) { setParam('branch', activeService.branches[0].id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, branchId, activeService]);

  if (services.length === 0) {
    return <span className="text-sm text-gray-400">No services enabled yet</span>;
  }

  const branchControl = (service) => {
    if (!service) return null;
    if (service.branches.length > 1) {
      return (
        <select
          value={branchId}
          onChange={(e) => setParam('branch', e.target.value)}
          className="border rounded px-2 py-1.5 bg-white text-gray-700 max-w-[10rem]"
        >
          <option value="">All branches</option>
          {service.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      );
    }
    if (service.branches.length === 1) {
      return <span className="text-gray-500">{service.branches[0].name}</span>;
    }
    return null;
  };

  if (services.length === 1) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-700">{services[0].name || services[0].type}</span>
        {branchControl(services[0])}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        value={serviceId}
        onChange={(e) => setParam('service', e.target.value)}
        className="border rounded px-2 py-1.5 bg-white text-gray-700 max-w-[10rem]"
      >
        <option value="">All services</option>
        {services.map((s) => <option key={s.id} value={s.id}>{s.name || s.type}</option>)}
      </select>
      {branchControl(activeService)}
    </div>
  );
}
