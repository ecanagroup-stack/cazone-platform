'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls, ReportToolbar } from '@/components/ui';

const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };

// Plain-language, not a permission-key matrix — platform-ui skill, section 5.
const ROLE_DESCRIPTIONS = [
  { role: 'Owner', can: 'Everything — services, branches, billing, and every other user. Set once at signup.' },
  { role: 'Manager', can: 'Invite users, manage services and branches.' },
  { role: 'Staff', can: 'Day-to-day work on the branches they are assigned to.' },
];

const blankInvite = { name: '', identifier: '', role: 'staff', password: '', branchIds: [] };

export default function UsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState(null);
  const [services, setServices] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState(blankInvite);
  const [submitting, setSubmitting] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [settingPin, setSettingPin] = useState(false);

  const load = async () => {
    const [ur, sr] = await Promise.all([fetch('/api/admin/users'), fetch('/api/admin/services')]);
    const [ud, sd] = await Promise.all([ur.json(), sr.json()]);
    if (ud.success) setUsers(ud.data); else toast.error(ud.error || 'Failed to load users');
    if (sd.success) setServices(sd.data);
  };

  useEffect(() => { load(); }, []);

  const toggleBranch = (branchId) => {
    setForm((f) => ({
      ...f,
      branchIds: f.branchIds.includes(branchId) ? f.branchIds.filter((id) => id !== branchId) : [...f.branchIds, branchId],
    }));
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowInvite(false); setForm(blankInvite); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (user) => {
    const goingActive = !user.isActive;
    if (!goingActive && !confirm(`Deactivate ${user.name}? Their history stays, they just can't log in.`)) return;
    const r = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: goingActive }),
    });
    const d = await r.json();
    if (d.success) load();
    else toast.error(d.error);
  };

  const handleSetPin = async (e) => {
    e.preventDefault();
    setSettingPin(true);
    try {
      const r = await fetch('/api/admin/users/me/action-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
      });
      const d = await r.json();
      if (d.success) { toast.success('Action PIN set'); setShowPin(false); setPin(''); }
      else toast.error(d.error);
    } finally {
      setSettingPin(false);
    }
  };

  if (!users) return <Loader />;

  const allBranches = services.flatMap((s) => s.branches.map((b) => ({ ...b, serviceName: s.name })));

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Who has access, and to what"
        action={<button onClick={() => { setForm(blankInvite); setShowInvite(true); }} className={btnPrimaryCls}>Invite User</button>}
      />

      <Card className="p-4 mb-6">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {ROLE_DESCRIPTIONS.map((r) => (
              <tr key={r.role}>
                <td className="py-2 pr-4 font-medium w-28">{r.role}</td>
                <td className="py-2 text-gray-600">{r.can}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b flex justify-end">
          <ReportToolbar
            title="Users"
            csvFilename="users"
            csvRows={users}
            csvColumns={[
              { key: 'name', label: 'Name' },
              { key: 'role', label: 'Role', value: (r) => ROLE_LABELS[r.role] || r.role },
              { key: 'login', label: 'Login', value: (r) => r.email || r.username || r.phone || '' },
              { key: 'isActive', label: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
            ]}
          />
        </div>
        <div className={tableScrollCls}>
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Role</th>
                <th className="px-4 py-3 text-left font-medium">Login</th>
                <th className="px-4 py-3 text-left font-medium">Branches</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.length === 0 && <EmptyRow colSpan={6} text="No users yet" />}
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3">{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email || u.username || u.phone || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.role === 'owner' ? 'All branches' : (u.branchAccess?.length ? u.branchAccess.map((a) => a.branch.name).join(', ') : 'None assigned')}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={u.isActive ? 'Active' : 'Inactive'} color={u.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right space-x-3">
                    {u.id === session?.user?.id && (
                      <button onClick={() => { setPin(''); setShowPin(true); }} className={tableActionCls}>Set My PIN</button>
                    )}
                    {u.role !== 'owner' && (
                      <button onClick={() => toggleActive(u)} className={tableActionCls}>
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Invite User">
        <form onSubmit={handleInvite} className="space-y-4">
          <Field label="Name" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required autoFocus />
          </Field>
          <Field label="Email, username or phone" required>
            <input type="text" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} className={inputCls} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" required>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </Field>
            <Field label="Password" required>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} required minLength={8} />
            </Field>
          </div>
          {allBranches.length > 0 && (
            <Field label="Branches">
              <div className="flex flex-wrap gap-3 max-h-32 overflow-y-auto">
                {allBranches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <FormButtons onCancel={() => setShowInvite(false)} submitting={submitting} submitLabel="Invite User" />
        </form>
      </Modal>

      <Modal open={showPin} onClose={() => setShowPin(false)} title="Set My Action PIN">
        <form onSubmit={handleSetPin} className="space-y-4">
          <p className="text-sm text-gray-500">A short PIN, separate from your login password, that you'll be asked for on the highest-stakes actions (credit overrides, price approvals).</p>
          <Field label="PIN (4-6 digits)" required>
            <input type="password" inputMode="numeric" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value)} className={inputCls} required autoFocus />
          </Field>
          <FormButtons onCancel={() => setShowPin(false)} submitting={settingPin} submitLabel="Set PIN" />
        </form>
      </Modal>
    </div>
  );
}
