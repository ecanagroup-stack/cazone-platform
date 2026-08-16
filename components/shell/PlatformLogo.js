'use client';

import { useState, useEffect } from 'react';
import { Logo } from '@/components/ui';

// Cazone's own uploaded mark (app/platform/settings) wherever the app shows its own brand rather
// than an org's — login, signup, the platform console header. Falls back to the static <Logo> mark,
// never a "no logo" placeholder box (unlike OrgLogo) — this is chrome every visitor sees, not an
// admin screen reporting on upload state.
export default function PlatformLogo({ className = 'h-8 w-8' }) {
  const [logoUrl, setLogoUrl] = useState(null);

  useEffect(() => {
    fetch('/api/branding').then((r) => r.json()).then((d) => {
      if (d.success) setLogoUrl(d.data.logoUrlSmall || d.data.logoUrl);
    });
  }, []);

  if (!logoUrl) return <Logo className={className} />;
  return <img src={logoUrl} alt="Cazone" className={`${className} object-contain rounded`} />;
}
