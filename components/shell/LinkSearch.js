'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FiArrowRight, FiSearch, FiX } from 'react-icons/fi';
import { visibleAdminGroups } from './Sidebar';

export default function LinkSearch({ links = [] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return links.filter((link) => !needle || `${link.label} ${link.group}`.toLocaleLowerCase().includes(needle));
  }, [links, query]);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const show = () => { setQuery(''); setSelected(0); setOpen(true); };
  const go = (link) => { setOpen(false); router.push(link.href); };

  return <>
    <button type="button" onClick={show} aria-label="Search pages" title="Search pages (Ctrl+K)" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-600 shadow-sm transition-colors hover:border-brand-300 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:px-3">
      <FiSearch size={17} aria-hidden="true" /><span className="hidden sm:inline">Search</span>
      <span className="hidden lg:inline rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400">Ctrl K</span>
    </button>
    {open && <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/45 px-3 pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Search pages" className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <FiSearch size={19} className="shrink-0 text-brand-600" aria-hidden="true" />
          <input autoFocus type="search" aria-label="Search available pages" placeholder="Search pages you can access..." value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, Math.max(matches.length - 1, 0))); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
            if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); go(matches[selected]); }
          }} className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400" />
          <button type="button" onClick={() => setOpen(false)} aria-label="Close search" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><FiX size={18} /></button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2" role="listbox" aria-label="Available pages">
          {matches.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-500">No available pages match “{query}”.</p>}
          {matches.map((link, index) => <button key={`${link.group}-${link.label}-${link.href}`} type="button" role="option" aria-selected={index === selected} onMouseEnter={() => setSelected(index)} onClick={() => go(link)} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors ${index === selected ? 'bg-brand-50 text-brand-800' : 'text-gray-700 hover:bg-gray-50'}`}>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{link.label}</span><span className="block text-xs text-gray-500">{link.group}</span></span>
            <FiArrowRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
          </button>)}
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">Use ↑ ↓ to choose and Enter to open</div>
      </div>
    </div>}
  </>;
}

export function AdminLinkSearch({ services, businessType, role }) {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get('service') || '';
  const branchId = searchParams.get('branch') || '';
  const params = new URLSearchParams();
  if (serviceId) params.set('service', serviceId);
  if (branchId) params.set('branch', branchId);
  const suffix = params.toString();
  const links = visibleAdminGroups({ services, businessType, role, serviceId }).flatMap((group) => group.items.map((item) => ({
    label: item.label,
    group: group.label,
    href: item.href === '/admin/customers' || !suffix ? item.href : `${item.href}?${suffix}`,
  })));
  return <LinkSearch links={links} />;
}
