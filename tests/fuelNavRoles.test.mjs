import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FUEL_SUMMARY_ROLES, FUEL_DAY_DETAIL_ROLES, FUEL_PERFORMANCE_ROLES, REPORT_ROLES } from '../lib/permissions.js';

// The role sets the read-only fuel/report APIs gate on are a hand copy of what the sidebar shows each
// page to. Every role the sidebar offers a page to must be let through by the matching API gate, or the
// page opens and then fails to load.
const sidebar = readFileSync(new URL('../components/shell/Sidebar.js', import.meta.url), 'utf8');

function rolesShownFor(href) {
  const roles = new Set();
  for (const line of sidebar.split('\n')) {
    if (!line.includes(`href: '${href}'`)) continue;
    const match = line.match(/roles: \[([^\]]*)\]/);
    if (match) for (const role of match[1].match(/'([^']+)'/g) || []) roles.add(role.slice(1, -1));
  }
  return [...roles];
}

const cases = [
  ['/admin/fuel/summary-book', FUEL_SUMMARY_ROLES],
  ['/admin/fuel/backfill', FUEL_DAY_DETAIL_ROLES],
  ['/admin/fuel/attendant-performance', FUEL_PERFORMANCE_ROLES],
  ['/admin/reports', REPORT_ROLES],
];

for (const [href, allowed] of cases) {
  test(`every role the sidebar shows ${href} to passes its API role gate`, () => {
    const shown = rolesShownFor(href);
    assert.ok(shown.length > 0, 'found no sidebar roles to compare');
    for (const role of shown) assert.ok(allowed.includes(role), `${role} sees ${href} but is refused by its API`);
  });
}
