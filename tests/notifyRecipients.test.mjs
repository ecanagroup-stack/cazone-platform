import test from 'node:test';
import assert from 'node:assert/strict';
import { alterationRecipients, alterationRecipientRoles } from '../lib/notifyRecipients.mjs';

const users = [
  { id: 'admin', role: 'owner', isActive: true, branchIds: [] },
  { id: 'gsm', role: 'materials_manager', isActive: true, branchIds: [] },
  { id: 'aud', role: 'auditor', isActive: true, branchIds: [] },
  { id: 'daud', role: 'daily_auditor', isActive: true, branchIds: [] },
  { id: 'mgrA', role: 'manager', isActive: true, branchIds: ['A'] },
  { id: 'mgrB', role: 'manager', isActive: true, branchIds: ['B'] },
  { id: 'mgrAB', role: 'manager', isActive: true, branchIds: ['A', 'B'] },
  { id: 'inactiveMgrA', role: 'manager', isActive: false, branchIds: ['A'] },
  { id: 'cashier', role: 'cashier', isActive: true, branchIds: ['A'] },
];
const sorted = (ids) => [...ids].sort();

test('GSM manager alteration goes to Admin, auditors and the branch manager', () => {
  const ids = alterationRecipients({ actor: { id: 'gsm', role: 'materials_manager' }, branchId: 'A', users });
  assert.deepEqual(sorted(ids), sorted(['admin', 'aud', 'daud', 'mgrA', 'mgrAB']));
});

test('Admin alteration goes to GSM manager, auditors and the branch manager', () => {
  const ids = alterationRecipients({ actor: { id: 'admin', role: 'owner' }, branchId: 'B', users });
  assert.deepEqual(sorted(ids), sorted(['gsm', 'aud', 'daud', 'mgrB', 'mgrAB']));
});

test('auditor alteration goes to Admin, GSM manager and the branch manager', () => {
  const ids = alterationRecipients({ actor: { id: 'aud', role: 'auditor' }, branchId: 'A', users });
  assert.deepEqual(sorted(ids), sorted(['admin', 'gsm', 'mgrA', 'mgrAB']));
});

test('any other actor notifies Admin, GSM manager, auditors and the branch manager, but not themselves', () => {
  const ids = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchId: 'A', users });
  assert.deepEqual(sorted(ids), sorted(['admin', 'gsm', 'aud', 'daud', 'mgrA', 'mgrAB']));
});

test('a branch manager acting is excluded from their own notice', () => {
  const ids = alterationRecipients({ actor: { id: 'mgrA', role: 'manager' }, branchId: 'A', users });
  assert.ok(!ids.includes('mgrA'));
  assert.ok(ids.includes('mgrAB'));
});

test('managers of other branches and inactive managers are never notified', () => {
  const ids = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchId: 'A', users });
  assert.ok(!ids.includes('mgrB'));
  assert.ok(!ids.includes('inactiveMgrA'));
});

test('a manager with no branch rows is unrestricted and is notified for any affected branch', () => {
  const withUnrestricted = [...users, { id: 'mgrAll', role: 'manager', isActive: true, branchIds: [] }];
  const ids = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchId: 'B', users: withUnrestricted });
  assert.ok(ids.includes('mgrAll'));
  assert.ok(!ids.includes('mgrA'));
  const noBranch = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchId: null, users: withUnrestricted });
  assert.ok(!noBranch.includes('mgrAll'));
});

test('without a branch no manager is notified', () => {
  const ids = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchId: null, users });
  assert.deepEqual(sorted(ids), sorted(['admin', 'gsm', 'aud', 'daud']));
});

test('a customer-level change notifies the managers of every branch the customer belongs to', () => {
  const ids = alterationRecipients({ actor: { id: 'gsm', role: 'materials_manager' }, branchIds: ['A', 'B'], users });
  assert.deepEqual(sorted(ids), sorted(['admin', 'aud', 'daud', 'mgrA', 'mgrB', 'mgrAB']));
});

test('unknown actor role falls through to the default recipient set', () => {
  assert.deepEqual(alterationRecipientRoles(undefined), ['owner', 'materials_manager', 'auditor', 'daily_auditor', 'external_auditor']);
});
