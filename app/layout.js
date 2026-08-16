import './globals.css';
import { Toaster } from 'react-hot-toast';
import Providers from '@/components/Providers';
import prisma from '@/lib/prisma';

// Without this, login/signup have no other dynamic dependency and Next prerenders them once at
// build time — baking in whatever the favicon was then, so a super_admin's upload wouldn't show up
// until the next deploy. Forcing every route dynamic (nested layouts already do this individually)
// keeps the favicon live immediately, matching "automatically" from the actual ask.
export const dynamic = 'force-dynamic';

// The default favicon — Cazone's own uploaded logo (app/platform/settings), if any. Nested layouts
// (app/admin, app/portal) override this with the signed-in org's own logo when it has one; when it
// doesn't, Next.js metadata inheritance falls back to whatever this returns.
export async function generateMetadata() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
  const icon = settings?.logoUrlSmall || settings?.logoUrl;
  return {
    title: 'Cazone',
    description: 'Cazone — the multi-tenant platform for running a business on the counter and on credit.',
    icons: icon ? { icon } : undefined,
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
