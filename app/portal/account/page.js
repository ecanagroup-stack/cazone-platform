'use client';

import { Card, PageHeader, ChangePasswordForm } from '@/components/ui';

// The portal's one self-service account screen — currently just the password, the one thing a
// customer can change about their own login without staff involvement (name/email/phone stay
// staff-managed, same as the rest of Customer). Shares ChangePasswordForm with the admin TopBar's
// modal — same /api/account/change-password either way, a customer login is just a User row too
// (lib/auth.js).
export default function PortalAccountPage() {
  return (
    <div>
      <PageHeader title="Account" subtitle="Manage your login" />
      <Card className="p-4 max-w-sm">
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
