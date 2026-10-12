'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Card, Field, Loader, OtpField, PageHeader, inputCls, btnPrimaryCls } from '@/components/ui';

export default function ActivateFuelOperationsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readings, setReadings] = useState({});
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [otp, setOtp] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/fuel/activate', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not load the station setup');
        setData(body);
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  const tanks = data?.branches?.flatMap((branch) => branch.tanks.map((tank) => ({ ...tank, branchId: branch.id, branchName: branch.name }))) || [];
  const allReadingsEntered = tanks.length > 0 && tanks.every((tank) => {
    const litres = readings[tank.id];
    return litres !== undefined && litres !== '' && Number.isFinite(Number(litres)) && Number(litres) >= 0 && Number(litres) <= tank.capacity;
  });

  const activate = async (event) => {
    event.preventDefault();
    if (!confirm(`Use these physical tank readings as ${data.organizationName}'s opening stock and enable station operations?`)) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/fuel/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation, otp, reason,
          tankReadings: tanks.map((tank) => ({ tankId: tank.id, litres: readings[tank.id] })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Station activation failed');
      toast.success(`Station operations started with ${body.tankCount} signed tank readings`);
      router.replace(`/admin/fuel/dashboard?service=${body.serviceId}${body.branchId ? `&branch=${body.branchId}` : ''}`);
      router.refresh();
    } catch (activationError) {
      toast.error(activationError.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader />;
  if (error) return <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</Card>;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Start station operations" subtitle="Set verified opening stock before recording new station activity." />

      {data?.isActive && !data?.pending ? (
        <Card className="border-green-200 bg-green-50 p-6">
          <h2 className="font-semibold text-green-950">Station operations are active</h2>
          <p className="mt-1 text-sm text-green-800">Opening stock has been recorded. You can begin a shift from the Pumps page.</p>
          <button type="button" onClick={() => router.push(`/admin/fuel/shift?service=${data.serviceId}${data.branches?.[0]?.id ? `&branch=${data.branches[0].id}` : ''}`)} className="mt-4 text-sm font-semibold text-green-800 underline">Open Pumps</button>
        </Card>
      ) : session?.user?.role !== 'owner' ? (
        <Card className="border-amber-200 bg-amber-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-800">Owner action required</p>
          <h2 className="mt-1 text-lg font-semibold text-amber-950">Opening stock must be signed by the account owner</h2>
          <p className="mt-2 text-sm text-amber-900">Your {session?.user?.role?.replaceAll('_', ' ') || 'staff'} account can manage station work after activation. Ask {data.organizationName}’s owner to enter the current physical dip for every active tank here.</p>
        </Card>
      ) : !data?.pending ? (
        <Card className="p-6">
          <h2 className="font-semibold">This station service is not waiting for activation</h2>
          <p className="mt-1 text-sm text-gray-600">Refresh the page or return to the station dashboard.</p>
        </Card>
      ) : (
        <>
          <Card className="border-amber-200 bg-amber-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-800">Why station work is paused</p>
            <p className="mt-1 text-sm text-amber-950">Record today’s actual physical litres in each active tank. The system will reconcile those readings against any remaining saved stock ledger, record the adjustment and your evidence reference, and then enable station operations.</p>
            <p className="mt-2 text-sm font-semibold text-amber-950">{tanks.length} active tanks across {data.branches.length} stations</p>
          </Card>

          {data.branches.map((branch) => (
            <Card key={branch.id} className="overflow-hidden p-0">
              <div className="border-b bg-gray-50 px-5 py-4">
                <h2 className="font-semibold text-gray-900">{branch.name}</h2>
                <p className="mt-0.5 text-xs text-gray-500">Enter litres from the current physical dip for each tank.</p>
              </div>
              <div className="divide-y">
                {branch.tanks.map((tank) => (
                  <div key={tank.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_12rem] sm:items-center">
                    <div>
                      <p className="font-medium text-gray-900">{tank.label} <span className="font-normal text-gray-500">· {tank.product.name}</span></p>
                      <p className="mt-0.5 text-xs text-gray-500">Capacity {tank.capacity.toLocaleString()} L</p>
                    </div>
                    <Field label="Measured stock (L)" required>
                      <input
                        className={inputCls} type="number" min="0" max={tank.capacity} step="0.1" required
                        value={readings[tank.id] ?? ''}
                        onChange={(event) => setReadings((current) => ({ ...current, [tank.id]: event.target.value }))}
                        placeholder="Read dip chart"
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </Card>
          ))}

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold text-gray-900">Sign and activate</h2>
            <p className="text-sm text-gray-600">The readings apply to all listed stations at once. Keep your signed paper or electronic dip record; this action records its reference and your approval.</p>
            <Field label="Signed dip record or evidence reference" required>
              <textarea className={inputCls} rows={3} minLength={8} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example, opening dip sheet signed by the station manager on 12 October 2026" required />
            </Field>
            <Field label={`Type “${data.organizationName}” to confirm`} required>
              <input className={inputCls} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required />
            </Field>
            <OtpField purpose="fuel_startup_stock" value={otp} onChange={setOtp} />
            <button
              type="button" disabled={saving || !allReadingsEntered || reason.trim().length < 8 || confirmation !== data.organizationName || otp.length !== 6}
              onClick={activate} className={`${btnPrimaryCls} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {saving ? 'Recording opening stock…' : `Record ${tanks.length} readings and start operations`}
            </button>
          </Card>
        </>
      )}
    </div>
  );
}
