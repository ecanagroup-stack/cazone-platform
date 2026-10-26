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

test('a manager with no branch rows has no station and is never notified', () => {
  const withUnassigned = [...users, { id: 'mgrNone', role: 'manager', isActive: true, branchIds: [] }];
  const ids = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchId: 'B', users: withUnassigned });
  assert.ok(!ids.includes('mgrNone'));
  assert.ok(ids.includes('mgrB'));
  const customerLevel = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchIds: ['A', 'B'], users: withUnassigned });
  assert.ok(!customerLevel.includes('mgrNone'));
  const noBranch = alterationRecipients({ actor: { id: 'cashier', role: 'cashier' }, branchId: null, users: withUnassigned });
  assert.ok(!noBranch.includes('mgrNone'));
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

test('an auditor or GSM limited to other branches is not told, one limited to the affected branch is', () => {
  const scoped = [
    { id: 'audA', role: 'auditor', isActive: true, branchIds: ['A'] },
    { id: 'audB', role: 'auditor', isActive: true, branchIds: ['B'] },
    { id: 'gsmB', role: 'materials_manager', isActive: true, branchIds: ['B'] },
    { id: 'audAll', role: 'auditor', isActive: true, branchIds: [] },
  ];
  const ids = alterationRecipients({ actor: { id: 'x', role: 'cashier' }, branchId: 'A', users: scoped });
  assert.deepEqual(sorted(ids), sorted(['audA', 'audAll']));
});
