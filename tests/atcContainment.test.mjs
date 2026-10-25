import test from 'node:test';
import assert from 'node:assert/strict';
import { atcManagerMayCall, atcManagerMayVisit, isConfinedAtcManager } from '../lib/atcContainment.mjs';
import { invitableRolesForBusiness, isOrgWideRole } from '../lib/businessRoles.js';

test('only a fuel station ATC manager is confined', () => {
  assert.equal(isConfinedAtcManager({ role: 'atc_manager', businessType: 'fuel_station' }), true);
  assert.equal(isConfinedAtcManager({ role: 'atc_manager', businessType: 'shop' }), false);
  assert.equal(isConfinedAtcManager({ role: 'atc_manager', businessType: undefined }), false);
  assert.equal(isConfinedAtcManager({ role: 'manager', businessType: 'fuel_station' }), false);
});

test('confined pages are the landing route, distribution and account', () => {
  for (const path of ['/admin', '/admin/distributor', '/admin/distributor/atcs', '/admin/distributor/orders', '/admin/account']) {
    assert.equal(atcManagerMayVisit(path), true, path);
  }
  for (const path of ['/admin/fuel/dashboard', '/admin/fuel/tank-stock', '/admin/deliveries', '/admin/users', '/admin/distributorx', '/admin/accounts', '/admin/fuel/distributor']) {
    assert.equal(atcManagerMayVisit(path), false, path);
  }
});

test('confined APIs are distribution, notifications, me and account', () => {
  for (const path of ['/api/admin/distributor/atcs', '/api/admin/distributor/atcs/abc/number', '/api/admin/notifications', '/api/admin/me', '/api/admin/me/workspace', '/api/account/change-password']) {
    assert.equal(atcManagerMayCall(path), true, path);
  }
  for (const path of ['/api/admin/deliveries', '/api/admin/fuel/tanks', '/api/admin/users', '/api/admin/distributorx', '/api/admin/message']) {
    assert.equal(atcManagerMayCall(path), false, path);
  }
});

test('the distributor add-on unlocks the ATC manager role for fuel stations only', () => {
  assert.equal(invitableRolesForBusiness('fuel_station').includes('atc_manager'), false);
  assert.equal(invitableRolesForBusiness('fuel_station', ['distributor']).includes('atc_manager'), true);
  assert.equal(invitableRolesForBusiness('fuel_station', ['petrol_station']).includes('atc_manager'), false);
  // shops already list it, and it is not duplicated
  assert.equal(invitableRolesForBusiness('shop', ['distributor']).filter((r) => r === 'atc_manager').length, 1);
  assert.deepEqual(invitableRolesForBusiness('unknown', ['distributor']), []);
});

test('the ATC manager is organization-wide in a fuel station only', () => {
  assert.equal(isOrgWideRole('atc_manager', 'fuel_station'), true);
  assert.equal(isOrgWideRole('atc_manager', 'shop'), false);
  assert.equal(isOrgWideRole('staff', 'fuel_station'), false);
});
