'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls, ReportToolbar, PasswordInput, UsernameField } from '@/components/ui';

const ROLE_LABELS = {
  owner: 'Owner', manager: 'Manager', supervisor: 'Supervisor', cashier: 'Cashier',
  materials_manager: 'Materials Manager', atc_manager: 'ATC Manager', auditor: 'Auditor', staff: 'Staff',
};

// Plain-language, not a permission-key matrix — platform-ui skill, section 5.
const ROLE_DESCRIPTIONS = [
  { role: 'Owner', can: 'Everything — services, branches, billing, and every other user. Set once at signup.' },
  { role: 'Manager', can: 'Invite users, manage services and branches, and approve fuel readings/payments.' },
  { role: 'Supervisor', can: 'Fuel only — submits pump readings for a manager to approve.' },
  { role: 'Cashier', can: 'Fuel only — records payments collected for a manager to approve.' },
  { role: 'Materials Manager', can: 'Construction Material only — sales, customers, stock and catalog upkeep, no branch/user admin.' },
  { role: 'ATC Manager', can: 'Construction Material only — ATC allocation lifecycle (assign/loading/arrive) only.' },
  { role: 'Auditor', can: 'Raises flags on discrepancies; otherwise read-only.' },
  { role: 'Staff', can: 'Day-to-day work on the branches they are assigned to.' },
];

// Roles scoped to a specific pack only show once a branch of that pack's type is selected —
// same idea Sidebar.js already uses for currentServiceType, just applied to the invite form's role
// picker instead of nav items.
const ROLES_FOR_SERVICE_TYPE = { fuel_station: ['supervisor', 'cashier'], shop: ['materials_manager', 'atc_manager'] };
const UNIVERSAL_ROLES = ['manager', 'staff', 'auditor'];
const ROLE_OPTION_LABELS = { ...ROLE_LABELS, supervisor: 'Supervisor (fuel)', cashier: 'Cashier (fuel)', materials_manager: 'Materials Manager', atc_manager: 'ATC Manager' };

const blankInvite = { name: '', identifier: '', role: 'staff', password: '', branchIds: [] };

export default function UsersPage() {
  const [users, setUsers] = useState(null);
  const [services, setServices] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState(blankInvite);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const [ur, sr] = await Promise.all([fetch('/api/admin/users'), fetch('/api/admin/services')]);
    const [ud, sd] = await Promise.all([ur.json(), sr.json()]);
    if (ud.success) setUsers(ud.data); else toast.error(ud.error || 'Failed to load users');
    if (sd.success) setServices(sd.data);
  };

  useEffect(() => { load(); }, []);

  const allBranches = services.flatMap((s) => s.branches.map((b) => ({ ...b, serviceType: s.type, serviceName: s.name })));
  const selectedServiceTypes = [...new Set(form.branchIds.map((id) => allBranches.find((b) => b.id === id)?.serviceType).filter(Boolean))];
  const availableRoles = [
    ...UNIVERSAL_ROLES,
    ...selectedServiceTypes.flatMap((t) => ROLES_FOR_SERVICE_TYPE[t] || []),
  ];

  const toggleBranch = (branchId) => {
    setForm((f) => {
      const branchIds = f.branchIds.includes(branchId) ? f.branchIds.filter((id) => id !== branchId) : [...f.branchIds, branchId];
      const nextTypes = [...new Set(branchIds.map((id) => allBranches.find((b) => b.id === id)?.serviceType).filter(Boolean))];
      const nextRoles = [...UNIVERSAL_ROLES, ...nextTypes.flatMap((t) => ROLES_FOR_SERVICE_TYPE[t] || [])];
      return { ...f, branchIds, role: nextRoles.includes(f.role) ? f.role : 'staff' };
    });
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

  if (!users) return <Loader />;

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
                  <td className="px-4 py-3 text-right">
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
          <UsernameField
            label="Email, username or phone" mode="identifier" required
            value={form.identifier} onChange={(v) => setForm({ ...form, identifier: v })}
          />
          <Field label="Branches" required>
            <p className="text-xs text-gray-500 mb-2">Pick branches first — the role options below depend on what kind of business they belong to.</p>
            <div className="flex flex-wrap gap-3 max-h-32 overflow-y-auto">
              {allBranches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                  {b.name}
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" required>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                {availableRoles.map((r) => <option key={r} value={r}>{ROLE_OPTION_LABELS[r]}</option>)}
              </select>
            </Field>
            <Field label="Password" required>
              <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            </Field>
          </div>
          <FormButtons onCancel={() => setShowInvite(false)} submitting={submitting} submitLabel="Invite User" />
        </form>
      </Modal>
    </div>
  );
}
