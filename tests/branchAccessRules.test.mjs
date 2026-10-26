import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBranchAccess, seesEveryBranchWithoutRows, canAccessBranch, filterByBranchAccess, branchScope,
  mergeAssignedBranches, branchAssignmentError,
} from '../lib/branchAccessRules.mjs';

const access = (role, branchIds = [], businessType = 'fuel_station') => resolveBranchAccess({ role, businessType, branchIds });

test('the owner is never narrowed', () => {
  assert.equal(access('owner'), null);
  assert.equal(access('owner', ['A']), null);
});

test('a manager, supervisor, cashier or staff with no rows gets no branch (fail closed)', () => {
  for (const role of ['manager', 'supervisor', 'cashier', 'staff']) assert.deepEqual(access(role), []);
  assert.deepEqual(access('manager', [], 'shop'), []);
});

test('a role with rows is limited to those branches, de-duplicated', () => {
  assert.deepEqual(access('manager', ['A', 'B', 'A']), ['A', 'B']);
  assert.deepEqual(access('auditor', ['A']), ['A']);
});

test('auditors and the fuel ATC manager stay organization-wide without rows', () => {
  for (const role of ['auditor', 'daily_auditor', 'external_auditor', 'atc_manager']) assert.equal(access(role), null);
});

test('a shop ATC manager is branch-bound like every shop role', () => {
  assert.deepEqual(access('atc_manager', [], 'shop'), []);
  assert.deepEqual(access('atc_manager', ['A'], 'shop'), ['A']);
});

test('no role means no access', () => {
  assert.deepEqual(resolveBranchAccess({ role: undefined, branchIds: ['A'] }), []);
});

test('seesEveryBranchWithoutRows separates whole-business roles from unassigned staff', () => {
  assert.equal(seesEveryBranchWithoutRows('auditor', 'fuel_station'), true);
  assert.equal(seesEveryBranchWithoutRows('manager', 'fuel_station'), false);
});

test('canAccessBranch honours null, lists and missing ids', () => {
  assert.equal(canAccessBranch(null, 'A'), true);
  assert.equal(canAccessBranch(['A'], 'A'), true);
  assert.equal(canAccessBranch(['A'], 'B'), false);
  assert.equal(canAccessBranch([], 'A'), false);
  assert.equal(canAccessBranch(['A'], undefined), false);
});

test('list helpers filter by accessible ids', () => {
  const rows = [{ branchId: 'A' }, { branchId: 'B' }];
  assert.equal(filterByBranchAccess(rows, null), rows);
  assert.deepEqual(filterByBranchAccess(rows, ['B']), [{ branchId: 'B' }]);
  assert.deepEqual(filterByBranchAccess(rows, []), []);
  assert.deepEqual(filterByBranchAccess([{ id: 'A' }, { id: 'C' }], ['A'], (r) => r.id), [{ id: 'A' }]);
  assert.deepEqual(branchScope(null), {});
  assert.deepEqual(branchScope(['A']), { branchId: { in: ['A'] } });
  assert.deepEqual(branchScope([], 'id'), { id: { in: [] } });
});

test('an unrestricted actor replaces the whole station set', () => {
  assert.deepEqual(mergeAssignedBranches({ existingIds: ['A', 'B'], requestedIds: ['C', 'C'], actorIds: null }), ['C']);
});

test('a manager only changes the stations they manage and keeps the rest', () => {
  assert.deepEqual(mergeAssignedBranches({ existingIds: ['A', 'X'], requestedIds: ['B'], actorIds: ['A', 'B'] }).sort(), ['B', 'X']);
  assert.deepEqual(mergeAssignedBranches({ existingIds: ['A', 'X'], requestedIds: [], actorIds: ['A'] }), ['X']);
});

const base = { actorRole: 'owner', actorIds: null, targetRole: 'cashier', businessType: 'fuel_station', requestedIds: ['A'], finalIds: ['A'] };

test('the owner may assign any station to a staff role', () => {
  assert.equal(branchAssignmentError(base), null);
});

test('a staff role cannot be left with no station, but an auditor can', () => {
  assert.match(branchAssignmentError({ ...base, requestedIds: [], finalIds: [] }).error, /at least one station/);
  assert.equal(branchAssignmentError({ ...base, targetRole: 'auditor', requestedIds: [], finalIds: [] }), null);
});

test('the Admin account and the org-wide ATC manager take no stations', () => {
  assert.match(branchAssignmentError({ ...base, targetRole: 'owner' }).error, /Admin account/);
  assert.match(branchAssignmentError({ ...base, targetRole: 'atc_manager' }).error, /whole business/);
  assert.equal(branchAssignmentError({ ...base, targetRole: 'atc_manager', requestedIds: [], finalIds: [] }), null);
});

test('a manager cannot edit the Admin or other managers, or assign stations they do not manage', () => {
  const asManager = { ...base, actorRole: 'manager', actorIds: ['A'] };
  assert.equal(branchAssignmentError(asManager), null);
  assert.match(branchAssignmentError({ ...asManager, targetRole: 'manager' }).error, /Only the Admin/);
  assert.match(branchAssignmentError({ ...asManager, requestedIds: ['B'], finalIds: ['B'] }).error, /stations you manage/);
});

test('the shop GSM is a business-wide overseer: no rows sees every branch, rows narrow it', () => {
  assert.equal(access('materials_manager', [], 'shop'), null);
  assert.deepEqual(access('materials_manager', ['A'], 'shop'), ['A']);
});

test('only an unrestricted actor may leave an auditor with no station', () => {
  const asManager = { ...base, actorRole: 'manager', actorIds: ['A'], targetRole: 'auditor', requestedIds: [], finalIds: [] };
  assert.match(branchAssignmentError(asManager).error, /at least one station/);
  assert.equal(branchAssignmentError({ ...asManager, actorRole: 'owner', actorIds: null }), null);
});

test('stations are assigned to staff accounts only', () => {
  assert.match(branchAssignmentError({ ...base, targetRole: 'customer' }).error, /staff accounts/);
  assert.match(branchAssignmentError({ ...base, targetRole: 'super_admin' }).error, /staff accounts/);
});
