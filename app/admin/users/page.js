'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { invitableRolesForBusiness } from '@/lib/businessRoles';
import { Loader, PageHeader, Card, EmptyRow, Modal, FormButtons, Field, inputCls, StatusPill, btnPrimaryCls, theadCls, tableScrollCls, tableActionCls, ReportToolbar, PasswordInput, UsernameField } from '@/components/ui';

const ROLE_LABELS = {
  owner: 'Owner', manager: 'Manager', supervisor: 'Supervisor', cashier: 'Cashier',
  materials_manager: 'GSM Manager', atc_manager: 'ATC Manager', auditor: 'Auditor', daily_auditor: 'Daily Auditor', external_auditor: 'External Auditor', staff: 'Staff',
};

// The guide is selected from the registered business, never from a URL query parameter.
const ROLE_DESCRIPTIONS = {
  fuel_station: {
    owner: 'Manages stations, users, billing, and historical records.',
    manager: 'Manages stations and users; reviews pump readings, payments, and deposits.',
    supervisor: 'Runs assigned station shifts and submits pump and tank readings.',
    cashier: 'Records collections and deposits for assigned stations.',
    auditor: 'Raises flags on station discrepancies.',
    daily_auditor: 'Reviews daily fuel records and raises discrepancy flags.',
    external_auditor: 'Reviews fuel reports and audit history.',
    staff: 'Works on the stations they are assigned to.',
  },
  shop: {
    owner: 'Manages branches, users, billing, and construction-material operations.',
    manager: 'Manages branches, users, sales, and approvals.',
    materials_manager: 'Manages sales, customers, stock, catalog, adjustments, and announcements.',
    atc_manager: 'Manages ATC assignment, loading, and arrival.',
    auditor: 'Raises flags on discrepancies.',
    staff: 'Works on the branches they are assigned to.',
  },
  general_store: {
    owner: 'Manages stores, users, billing, and retail operations.',
    manager: 'Manages stores, users, sales, and approvals.',
    auditor: 'Raises flags on store discrepancies.',
    staff: 'Works on the stores they are assigned to.',
  },
};

const UNIVERSAL_ROLES = ['manager', 'staff', 'auditor'];
const FUEL_STAFF_ROLES = ['manager', 'supervisor', 'cashier', 'staff'];
const roleLabel = (role, businessType) =>
  role === 'owner' || invitableRolesForBusiness(businessType).includes(role) ? (ROLE_LABELS[role] || role) : 'Legacy role';

const blankUser = { name: '', identifier: '', role: 'staff', password: '', branchIds: [] };

export default function UsersPage() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [users, setUsers] = useState(null);
  const [services, setServices] = useState([]);
  const [businessType, setBusinessType] = useState(null);
  const [accessibleBranchIds, setAccessibleBranchIds] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankUser);
  const [submitting, setSubmitting] = useState(false);
  const [resetFor, setResetFor] = useState(null); // the user being password-reset, or null
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    const [ur, sr] = await Promise.all([fetch('/api/admin/users'), fetch('/api/admin/services')]);
    const [ud, sd] = await Promise.all([ur.json(), sr.json()]);
    if (ud.success) { setUsers(ud.data); setAccessibleBranchIds(ud.accessibleBranchIds ?? null); } else toast.error(ud.error || 'Failed to load users');
    if (sd.success) { setServices(sd.data); setBusinessType(sd.businessType); }
  };

  useEffect(() => { load(); }, []);

  const allBranches = services.flatMap((s) => s.branches.filter((b) => b.isActive && (!accessibleBranchIds || accessibleBranchIds.includes(b.id))).map((b) => ({ ...b, serviceType: s.type, serviceName: s.name })));
  const availableRoles = form.branchIds.length > 0
    ? invitableRolesForBusiness(businessType)
    : UNIVERSAL_ROLES.filter((role) => invitableRolesForBusiness(businessType).includes(role));

  const toggleBranch = (branchId) => {
    setForm((f) => {
      const branchIds = f.branchIds.includes(branchId) ? f.branchIds.filter((id) => id !== branchId) : [...f.branchIds, branchId];
      const nextRoles = branchIds.length > 0 ? invitableRolesForBusiness(businessType) : UNIVERSAL_ROLES.filter((role) => invitableRolesForBusiness(businessType).includes(role));
      return { ...f, branchIds, role: nextRoles.includes(f.role) ? f.role : 'staff' };
    });
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${form.name} added`); setShowAdd(false); setForm(blankUser); load(); }
      else toast.error(d.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetting(true);
    try {
      const r = await fetch(`/api/admin/users/${resetFor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword }),
      });
      const d = await r.json();
      if (d.success) { toast.success(`${resetFor.name}'s password was reset`); setResetFor(null); setNewPassword(''); }
      else toast.error(d.error);
    } finally {
      setResetting(false);
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

  if (!users || !businessType) return <Loader />;

  const fuelBusiness = businessType === 'fuel_station';
  const staffView = fuelBusiness && searchParams.get('view') === 'staff';
  const requestedBranch = fuelBusiness ? searchParams.get('branch') || '' : '';
  const selectedBranch = allBranches.some((branch) => branch.id === requestedBranch) ? requestedBranch : '';
  const filteredUsers = users.filter((user) => {
    if (staffView && !FUEL_STAFF_ROLES.includes(user.role)) return false;
    // A legacy account without explicit branch rows is unrestricted under getAccessibleBranchIds.
    if (selectedBranch && user.role !== 'owner' && user.branchAccess?.length && !user.branchAccess.some(({ branch }) => branch.id === selectedBranch)) return false;
    const value = search.trim().toLowerCase();
    return !value || [user.name, user.email, user.username, user.phone, roleLabel(user.role, businessType)].some((part) => part?.toLowerCase().includes(value));
  });
  const viewHref = (view) => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === 'staff') params.set('view', 'staff'); else params.delete('view');
    return `/admin/users?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title={fuelBusiness ? (staffView ? 'Station Staff' : 'Station Users') : 'Users'}
        subtitle={fuelBusiness ? 'One account list for station access, staff roles, and login management' : 'Who has access, and to what'}
        action={<button onClick={() => { setForm({ ...blankUser, branchIds: selectedBranch && allBranches.some((branch) => branch.id === selectedBranch) ? [selectedBranch] : [] }); setShowAdd(true); }} className={btnPrimaryCls}>{staffView ? 'Add Staff' : 'Add User'}</button>}
      />

      {fuelBusiness && <div className="mb-5 flex flex-wrap items-center gap-2" role="navigation" aria-label="Fuel users view"><Link href={viewHref('all')} className={`rounded-lg px-4 py-2 text-sm font-medium ${!staffView ? 'bg-brand-700 text-white' : 'border bg-white text-gray-700'}`}>All users</Link><Link href={viewHref('staff')} className={`rounded-lg px-4 py-2 text-sm font-medium ${staffView ? 'bg-brand-700 text-white' : 'border bg-white text-gray-700'}`}>Station staff</Link><span className="ml-auto text-xs text-gray-500">{filteredUsers.length} {filteredUsers.length === 1 ? 'account' : 'accounts'}{selectedBranch ? ' at selected station' : ''}</span></div>}

      {!staffView && <Card className="p-4 mb-6">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {['owner', ...invitableRolesForBusiness(businessType)].map((role) => (
              <tr key={role}>
                <td className="py-2 pr-4 font-medium w-28">{ROLE_LABELS[role]}</td>
                <td className="py-2 text-gray-600">{ROLE_DESCRIPTIONS[businessType]?.[role]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, login, or role" aria-label="Search users" className={`${inputCls} max-w-xs`} />
          <ReportToolbar
            title={staffView ? 'Station Staff' : 'Users'}
            csvFilename={staffView ? 'station-staff' : 'users'}
            csvRows={filteredUsers}
            csvColumns={[
              { key: 'name', label: 'Name' },
              { key: 'role', label: 'Role', value: (r) => roleLabel(r.role, businessType) },
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
              {filteredUsers.length === 0 && <EmptyRow colSpan={6} text={staffView ? 'No station staff found' : 'No users found'} />}
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3">{roleLabel(u.role, businessType)}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email || u.username || u.phone || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.role === 'owner' ? (fuelBusiness ? 'All stations' : 'All branches') : (u.branchAccess?.length ? u.branchAccess.map((a) => a.branch.name).join(', ') : (fuelBusiness ? 'All stations (legacy access)' : 'None assigned'))}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={u.isActive ? 'Active' : 'Inactive'} color={u.isActive ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right">
                    {(!fuelBusiness || session?.user?.role === 'owner' || !['owner', 'manager'].includes(u.role)) && <button onClick={() => { setResetFor(u); setNewPassword(''); }} className={`${tableActionCls} mr-3`}>Reset Password</button>}
                    {u.role !== 'owner' && (!fuelBusiness || session?.user?.role === 'owner' || u.role !== 'manager') && (
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

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={staffView ? 'Add Staff' : 'Add User'}>
        <form onSubmit={handleAdd} className="space-y-4">
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
                {availableRoles.filter((role) => !staffView || FUEL_STAFF_ROLES.includes(role)).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            <Field label="Password" required>
              <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            </Field>
          </div>
          <FormButtons onCancel={() => setShowAdd(false)} submitting={submitting} submitLabel={staffView ? 'Add Staff' : 'Add User'} />
        </form>
      </Modal>

      <Modal open={!!resetFor} onClose={() => setResetFor(null)} title={`Reset Password — ${resetFor?.name || ''}`}>
        <form onSubmit={handleResetPassword} className="space-y-4">
          <p className="text-sm text-gray-500">This sets their password directly — they won&apos;t need the old one. Tell them the new one yourself, or point them to Forgot Password on the sign-in page instead.</p>
          <Field label="New password" required>
            <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoFocus />
          </Field>
          <FormButtons onCancel={() => setResetFor(null)} submitting={resetting} submitLabel="Reset Password" />
        </form>
      </Modal>
    </div>
  );
}
