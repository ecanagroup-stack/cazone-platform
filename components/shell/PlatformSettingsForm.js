'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Card, OrgLogo } from '@/components/ui';
import { resizeImageToPng } from '@/lib/imageResize';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// Ported from components/shell/OrganizationProfileForm.js's logo section — same upload-on-select
// behavior, just against /api/platform/settings/logo (PlatformSettings singleton) instead of an
// org's own logo route.
export default function PlatformSettingsForm({ settings }) {
  const [logoUrl, setLogoUrl] = useState(settings?.logoUrl || '');
  const [uploading, setUploading] = useState(false);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) { toast.error('Logo must be a PNG, JPEG, WEBP, or SVG image'); e.target.value = ''; return; }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      try { body.append('smallFile', await resizeImageToPng(file, 200)); } catch { /* SVG or resize failure — full-size upload still proceeds */ }
      const r = await fetch('/api/platform/settings/logo', { method: 'POST', body });
      const d = await r.json();
      if (d.success) { setLogoUrl(d.data.logoUrl); toast.success('Logo uploaded — it will show as the favicon shortly'); }
      else toast.error(d.error);
    } catch (err) {
      toast.error(err.message || 'Something went wrong, please try again');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <Card className="p-5 mb-6">
      <h3 className="font-semibold text-sm mb-4">Cazone GS&amp;M Logo</h3>
      <div className="flex items-center gap-4">
        <OrgLogo org={{ name: 'Cazone GS&M', logoUrl }} dim="h-16 w-16" />
        <label className="px-3 py-1.5 border rounded text-sm font-medium hover:bg-gray-50 cursor-pointer">
          {uploading ? 'Uploading...' : 'Upload logo'}
          <input type="file" accept={ALLOWED_TYPES.join(',')} onChange={handleLogoUpload} disabled={uploading} className="hidden" />
        </label>
      </div>
    </Card>
  );
}
