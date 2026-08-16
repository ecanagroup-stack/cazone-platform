'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

// Always visible, even for a single-service/single-branch org — teaches the concept before it
// matters (platform-ui skill, section 2). Switching never changes the route, only its ?service=
// / ?branch= query scope, so a page can read the same params to filter once it has real data.
export default function ServiceBranchSwitcher({ services }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';
  const activeService = services.find((s) => s.id === serviceId);

  const setParam = (key, value) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key === 'service') params.delete('branch');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  if (services.length === 0) {
    return <span className="text-sm text-gray-400">No services enabled yet</span>;
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        value={serviceId}
        onChange={(e) => setParam('service', e.target.value)}
        className="border rounded px-2 py-1.5 bg-white text-gray-700 max-w-[10rem]"
      >
        <option value="">All services</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>{s.name || s.type}</option>
        ))}
      </select>
      {activeService && (
        <select
          value={branchId}
          onChange={(e) => setParam('branch', e.target.value)}
          className="border rounded px-2 py-1.5 bg-white text-gray-700 max-w-[10rem]"
        >
          <option value="">All branches</option>
          {activeService.branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
