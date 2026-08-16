'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Logo } from '@/components/ui';
import ServiceBranchSwitcher from './ServiceBranchSwitcher';
import NotificationBell from './NotificationBell';

// Business name, then service/branch switcher, then user menu — nothing else goes in the top bar
// (platform-ui skill, section 1). The business-name switcher itself is plain text here: no user
// belongs to more than one organization yet, so a dropdown would be premature.
export default function TopBar({ org, services, user }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="h-14 border-b bg-white flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2 shrink-0">
        <Logo className="h-7 w-7" />
        <span className="font-semibold text-gray-900 hidden sm:inline">{org?.name}</span>
      </div>

      <div className="flex-1 min-w-0">
        <ServiceBranchSwitcher services={services} />
      </div>

      <NotificationBell />

      <div className="relative shrink-0">
        <button type="button" onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 text-sm">
          <span className="h-8 w-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-medium">
            {(user?.name || '?').charAt(0).toUpperCase()}
          </span>
          <span className="hidden md:flex flex-col items-start leading-tight">
            <span className="font-medium text-gray-900">{user?.name}</span>
            <span className="text-xs text-gray-500 capitalize">{user?.role}</span>
          </span>
        </button>
        {menuOpen && (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-44 bg-white border rounded-lg shadow-lg py-1 z-20">
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
