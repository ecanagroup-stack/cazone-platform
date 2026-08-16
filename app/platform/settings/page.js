import prisma from '@/lib/prisma';
import PlatformSettingsForm from '@/components/shell/PlatformSettingsForm';

// super_admin-only — Cazone's own logo, used as the favicon everywhere and as the brand mark on
// login/signup/the platform console, unless (and until) an org uploads its own (app/admin/settings).
export default async function PlatformSettingsPage() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Platform Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Cazone's own logo — shown on login/signup and the platform console, and used as the favicon for any organization that hasn't uploaded its own.</p>
      </div>
      <PlatformSettingsForm settings={settings} />
    </div>
  );
}
