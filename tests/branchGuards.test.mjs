import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression guard for station (branch) isolation. Every HTTP handler under app/api/admin must either
// check the caller's branch access or be listed in ORG_LEVEL below with the reason it is allowed not to.
// A new route that forgets the check fails here instead of leaking one station's data to another's staff.
//
// Out of scope here: app/api/cron/auto-close-fuel-shifts (a secret-protected system job that closes every
// organization's stale shifts, no caller), and the portal and webhook routes, which have no staff session.

const API = fileURLToPath(new URL('../app/api/admin/', import.meta.url));
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// A call to one of the branch-access helpers (lib/branchAccess.js, lib/branchAccessRules.mjs) or to a
// helper that makes the check itself: createSaleOrder / assertBranchAccessible (lib/sale.js) and
// managerChatBranches (lib/chatBranches.js). An import alone does not match, only a call does.
const GUARD = /\b(requireBranch|requireRecordBranch|canAccessBranch|branchScope|filterByBranchAccess|getAccessibleBranchIds|assertBranchAccessible|createSaleOrder|managerChatBranches)\(/;

// Handlers that are deliberately not branch-scoped. Keys are `<route path under app/api/admin> <METHOD>`,
// or just the path to cover every handler in the file. The reason is required and reviewed with the entry.
const ORG_LEVEL = {
  // Fuel
  'fuel/trucks/[id] PATCH': 'Tankers are shared by every station in the business (Vehicle has no branch). Owner/manager only; taking a truck in or out of service is owner only, since it affects every station. The delivery history shown per truck is filtered by branch in GET fuel/trucks.',
  'fuel/trucks POST': 'Registers a business-wide tanker; Vehicle has no branch. Owner/manager only.',
  'fuel/shift/[id]/dispensers/[dispenserId]/credit-fill POST': 'Retired endpoint, always answers 410 and touches no data.',
  'fuel/prices POST': 'Owner only (the route refuses everyone else), who sees every station; the target station is validated against the org.',

  // Branches, services and pricing
  'branches POST': 'Always refuses: extra locations are bought as business add-ons, nothing is created here.',
  'services POST': 'Owner only (the route refuses everyone else). Enables the business line and creates its first branch; a service is org-level.',
  'services/[id]': 'Owner only (the route refuses everyone else). A service is org-level: deactivating it blocks every station, so a station manager must not reach it.',
  'pricing/[id]': 'Owner only (pricing.approve resolves true for the owner alone). Approving a price proposal is an Admin decision for any station.',

  // Distributor / ATC. PetroleumAtc has no branch: an ATC is a business-level asset (the allocation the
  // depot issues to the business), not stock held at one station. Access is by role (atc.*), and the
  // org-level atc_manager works across the whole business. The only branch-bound step is selling an ATC
  // at the counter, which is guarded in distributor/sell (customers restricted to the seller's stations).
  //
  // OPEN PRODUCT DECISION: lib/permissions.js gives the station manager atc.view / atc.manage / atc.sell,
  // so a manager limited to one station can read the whole business's ATC board (customer name and
  // phone, truck, driver, price) and edit, cancel or deliver any ATC. Closing that means either narrowing
  // atc.view / atc.manage to owner + atc_manager (+ auditors), or giving PetroleumAtc a seller branchId.
  // Until that is decided the entries below stay org-level and the exposure is accepted, not settled.
  'distributor/atcs': 'ATC board is business-level (PetroleumAtc has no branch); gated by atc.view / atc.sell / atc.manage.',
  'distributor/atcs/[id]': 'Edits a business-level ATC; gated by atc.manage.',
  'distributor/atcs/[id]/cancel': 'Cancels a business-level ATC; gated by atc.manage.',
  'distributor/atcs/[id]/number': 'Reveals the ATC number to owner / atc_manager only.',
  'distributor/orders': 'Lists business-level ATC orders; gated by atc.view.',
  'distributor/orders/[id]/deliver': 'Marks a business-level ATC order delivered; gated by atc.manage.',
  'distributor/pending-count': 'Count of sold-but-undelivered ATCs for the nav badge; business-level, gated by atc.view.',
  'distributor/price': 'The ATC price per litre is one org-wide PriceRule; Admin / manager set it.',
  'distributor/trucks': 'Business-wide tanker list for the ATC board; Vehicle has no branch.',

  // Org-level records: no branch of their own
  // customers GET and customers/[id] GET are branch-scoped: a customer is visible through its CustomerAccess rows.
  'customers/[id] PATCH': 'Org-level customer account (credit limit, hold, name); gated by customers.manage. Which stations a customer trades at is CustomerAccess, edited through customers/[id]/access, which is guarded.',
  'customers/[id]/adjustments': 'Customer balance adjustment; the customer is org-level and the permission is customer.adjustments.apply.',
  'customers/[id]/payments': 'Customer payment against an org-level balance; sales.record.',
  'customers/[id]/portal-access': 'Customer portal login; org-level.',
  'customers/[id]/pricing': 'Customer price list; org-level.',
  'customers/[id]/pricing/[productId]': 'Customer price list; org-level.',
  'customers/check-name': 'Duplicate-name check across the customers of the org.',
  'reports/balances': 'Customer balances are org-level (Customer has no branch); the route says so and ignores branch scoping.',
  'reports/email': 'Sends the CSV in the request body to the address in the request body. It reads no data of its own (the CSV was built client-side from guarded reports/* calls), so it is not an isolation leak, but it will mail any staff-supplied text to any address.',
  'audit': 'Owner only.',
  'billing/subscribe': 'Subscription of the organization itself.',
  'billing/cancel-subscription': 'Subscription of the organization itself.',
  'organization': 'The organization profile itself.',
  'organization/logo': 'The organization logo itself.',
  'settings/payments': 'Organization payment settings.',
  'settings/payments/resolve': 'Organization payment settings.',
  'provisioning-requests': 'Organization-level add-on purchase requests.',
  'provisioning-requests/[id]/pay': 'Organization-level add-on purchase.',
  'otp/request': 'Sends the caller their own one-time code.',
  'notifications': 'Scoped to the caller (recipient user / role), not to a branch.',

  // Catalog and shared records
  'materials/products POST': 'Product catalog is per service, not per branch (materials.catalog.manage).',
  'materials/products/[id]': 'Product catalog is per service, not per branch (materials.catalog.manage).',
  'materials/cement-brands': 'Product catalog is per service, not per branch.',
  'materials/cement-brands/[id]': 'Product catalog is per service, not per branch.',
  'materials/cement-brands/[id]/price': 'List price is an org-wide PriceRule; materials.catalog.manage.',
  'materials/stonedust': 'Product catalog is per service, not per branch.',
  'materials/stonedust/[id]': 'Product catalog is per service, not per branch.',
  'materials/stonedust/[id]/price': 'List price is an org-wide PriceRule; materials.catalog.manage.',
  'materials/suppliers': 'Suppliers are shared by every station (Supplier has no branch). /api/admin/suppliers re-exports these handlers.',
  'materials/suppliers/[id]': 'Suppliers are shared by every station (Supplier has no branch).',
  'materials/trucks': 'Vehicles have no branch.',
  'materials/trucks/[id]': 'Vehicles have no branch.',
};

function routeFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === 'route.js') out.push(full);
  }
  return out;
}

// Splits a route file into its top-level declarations and returns its exported handlers as
// { GET: { guarded, source } }. A handler counts as guarded when its own body calls a branch helper, or
// calls a helper function of the same file that does (backfill's per-type handlers, distributor/sell's
// customer filter).
function handlersOf(source) {
  const starts = [...source.matchAll(/^(?:export )?(?:async function|function|const|let)\s+(\w+)/gm)];
  const chunks = starts.map((mark, i) => ({
    name: mark[1], exported: mark[0].startsWith('export'), text: source.slice(mark.index, starts[i + 1]?.index ?? source.length),
  }));
  const helpers = chunks.filter((chunk) => !chunk.exported && GUARD.test(chunk.text)).map((chunk) => chunk.name);
  const handlers = {};
  for (const chunk of chunks) {
    if (!chunk.exported || !METHODS.includes(chunk.name)) continue;
    handlers[chunk.name] = {
      source: chunk.text,
      guarded: GUARD.test(chunk.text) || helpers.some((name) => new RegExp(`\\b${name}\\(`).test(chunk.text)),
    };
  }
  return handlers;
}

const files = routeFiles(API).map((file) => ({
  path: relative(API, file).split(sep).slice(0, -1).join('/'),
  handlers: handlersOf(readFileSync(file, 'utf8')),
}));

const orgLevel = (path, method) => ORG_LEVEL[`${path} ${method}`] || ORG_LEVEL[path];

test('every admin API handler checks the caller\'s branch or is listed as org-level', () => {
  const unguarded = [];
  for (const { path, handlers } of files) {
    for (const [method, { guarded }] of Object.entries(handlers)) {
      if (!guarded && !orgLevel(path, method)) unguarded.push(`${method} ${path}`);
    }
  }
  assert.deepEqual(unguarded, [], `these handlers have no branch check; add requireBranch / requireRecordBranch, or list them in ORG_LEVEL with a reason:\n${unguarded.join('\n')}`);
});

test('every fuel handler checks the branch, bar the listed org-level exceptions', () => {
  const fuel = files.filter((file) => file.path === 'fuel' || file.path.startsWith('fuel/'));
  assert.ok(fuel.length >= 30, 'found too few fuel routes; the directory walk is broken');
  for (const { path, handlers } of fuel) {
    for (const [method, { guarded }] of Object.entries(handlers)) {
      assert.ok(guarded || orgLevel(path, method), `${method} ${path} has no branch check`);
    }
  }
});

test('the branch-scoped write routes keep their checks', () => {
  // Spelled out so that moving a route into ORG_LEVEL cannot silently drop one of these.
  const required = [
    'fuel/shift/begin POST', 'fuel/shift/[id]/dispensers POST', 'fuel/shift/[id]/dispensers/[dispenserId] DELETE',
    'fuel/shift/[id]/dispensers/[dispenserId]/close POST', 'fuel/shift/[id]/dispensers/[dispenserId]/reassign POST',
    'fuel/shift/[id]/dispensers/[dispenserId]/approve POST', 'fuel/shift/[id]/dispensers/[dispenserId]/correct POST',
    'fuel/shift/[id]/dispensers/[dispenserId]/payment POST', 'fuel/shift/[id]/end POST',
    'fuel/tanks POST', 'fuel/tanks/[id] PATCH', 'fuel/tanks/[id]/reconcile POST',
    'fuel/dispensers POST', 'fuel/dispensers/[id] PATCH',
    'fuel/pos-terminals POST', 'fuel/pos-terminals/[id] PATCH',
    'fuel/attendants POST', 'fuel/attendants/[id] PATCH', 'fuel/attendants/[id]/notes POST',
    'fuel/collections GET', 'fuel/collections/[id]/void POST', 'fuel/backfill POST', 'fuel/audit-comments POST',
    'branches/[id] PATCH', 'deliveries POST', 'deliveries/[id]/correct POST', 'deliveries/[id]/arrive POST',
    'deliveries/[id]/assign POST', 'deliveries/[id]/loading POST',
    'deposits POST', 'deposits/[id] PATCH', 'deposits/[id]/correct POST', 'exceptions/[id] PATCH',
    // Reads and lists, pinned so a refactor cannot drop their checks either.
    'fuel/summary-book GET', 'fuel/day-detail GET', 'fuel/attendant-performance GET', 'fuel/attendants GET',
    'fuel/tanks GET', 'fuel/pos-terminals GET', 'fuel/tanks/[id]/reconciliations GET', 'fuel/shift/[id]/reassignments GET',
    'fuel/attendants/[id] GET', 'deliveries GET', 'customers GET', 'customers/[id] GET',
    'materials/atcs GET', 'customers/search GET',
  ];
  for (const key of required) {
    const [path, method] = [key.slice(0, key.lastIndexOf(' ')), key.slice(key.lastIndexOf(' ') + 1)];
    const handler = files.find((file) => file.path === path)?.handlers[method];
    assert.ok(handler, `${key} not found`);
    assert.ok(handler.guarded, `${key} lost its branch check`);
    assert.ok(!orgLevel(path, method), `${key} must not be listed as org-level`);
  }
});

// /[id] routes whose branch check legitimately is not "the loaded record's branchId": the path id is the
// branch itself, the record has no branch of its own (a customer, a user), or the branch is a target the
// caller names and that is itself checked.
const BRANCH_FROM_REQUEST = {
  'chat/[customerId]': 'A customer has no branch; the thread is limited to the stations of the caller through managerChatBranches.',
  'customers/[id]': 'A customer has no branch; GET is scoped to the stations of the caller through CustomerAccess (PATCH is org-level, listed above).',
  'users/[id]': 'A user has no branch; assigned stations are checked by branchAssignmentError / mergeAssignedBranches against the own stations of the caller.',
  'branches/[id]': 'The path id is the branch itself, checked with requireBranch(session, id).',
  'customers/[id]/access': 'Grants or revokes a customer at a station the caller names; each target station is checked with canAccessBranch.',
  'materials/products/[id]/stock-in': 'Receives stock into a station the caller names; that station is checked with canAccessBranch.',
};

// Matched line by line, so a nested call such as requireBranch(await getOrgSession(), body.branchId) cannot hide.
const CLIENT_BRANCH = /\b(requireBranch|requireRecordBranch|canAccessBranch|assertBranchAccessible)\(.*\b(body|input|searchParams|params)\b.*branchId/;
const RECORD_BRANCH = /\b(requireBranch|canAccessBranch|assertBranchAccessible)\(.*\b(?!body\b|input\b|searchParams\b|params\b)\w+\??\.branchId\b/;

test('a route addressed by id derives the branch from the record, not from the request', () => {
  // `/[id]` handlers must pass the loaded record to requireRecordBranch, or a loaded record's branchId to
  // another guard. A branch id read from the body or query is whatever the caller typed, and a handler that
  // only filters a list with getAccessibleBranchIds has not checked the record it was asked for.
  const bad = [];
  for (const { path, handlers } of files) {
    if (!path.includes('[') || BRANCH_FROM_REQUEST[path]) continue;
    for (const [method, { source }] of Object.entries(handlers)) {
      if (orgLevel(path, method)) continue;
      const lines = source.split('\n');
      if (lines.some((line) => CLIENT_BRANCH.test(line))) bad.push(`${method} ${path}: checks a branch id that came from the request`);
      else if (!/\brequireRecordBranch\(/.test(source) && !lines.some((line) => RECORD_BRANCH.test(line))) {
        bad.push(`${method} ${path}: does not check the loaded record's branch (use requireRecordBranch)`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('a record is judged by its branch before its status can leak', () => {
  // The branch check must run before a business-rule answer (409 already corrected, 400 not open), so a
  // caller from another station cannot tell a closed shift from an open one.
  const order = [
    ['fuel/shift/[id]/end', 'POST', /shift\.status/],
    ['fuel/collections/[id]/void', 'POST', /collection\.voidedAt/],
    ['fuel/shift/[id]/dispensers/[dispenserId]/payment', 'POST', /shift\.status/],
  ];
  for (const [path, method, status] of order) {
    const source = files.find((file) => file.path === path)?.handlers[method]?.source;
    assert.ok(source, `${method} ${path} not found`);
    const guard = source.search(/requireRecordBranch\(/);
    const first = source.search(status);
    assert.ok(guard >= 0 && first >= 0, `${method} ${path}: expected a requireRecordBranch call and a status check`);
    assert.ok(guard < first, `${method} ${path} reads the record's status before checking its branch`);
  }
});

test('the org-level list holds no stale entries', () => {
  const stale = [];
  for (const key of Object.keys(ORG_LEVEL)) {
    const cut = key.lastIndexOf(' ');
    const hasMethod = cut > 0 && METHODS.includes(key.slice(cut + 1));
    const path = hasMethod ? key.slice(0, cut) : key;
    const file = files.find((f) => f.path === path);
    if (!file) { stale.push(`${key}: no such route`); continue; }
    if (hasMethod && !file.handlers[key.slice(cut + 1)]) { stale.push(`${key}: that route has no such handler`); continue; }
    const guarded = Object.entries(file.handlers)
      .filter(([method]) => !hasMethod || key.endsWith(` ${method}`))
      .filter(([, handler]) => handler.guarded);
    if (guarded.length) stale.push(`${key} is listed as org-level but ${guarded.map(([m]) => m).join('/')} already checks the branch; drop the entry`);
    assert.ok(ORG_LEVEL[key].length > 10, `${key} needs a reason`);
  }
  assert.deepEqual(stale, []);
});

test('the route directory exists', () => {
  assert.ok(existsSync(API));
  assert.ok(files.length > 50);
});
