import { AsyncLocalStorage } from 'node:async_hooks';

// Holds the current request's tenant context: either { organizationId } (scoped) or
// { unscoped: true }. If neither is set, tenant-scoped Prisma queries FAIL CLOSED (see lib/prisma.js)
// — a query throws rather than silently returning another org's data. The few legitimate global
// paths (login lookup, migrations, the /platform super-admin area) opt out explicitly via
// runUnscoped(). Same design as ecana_shop-app's lib/tenantScope.js, ported to be Prisma-agnostic.
//
// Pinned to globalThis so it's a true singleton across route bundles / hot reloads — if a route's
// run() and the Prisma extension's getScope() landed on different AsyncLocalStorage instances, every
// scoped query would fail closed.
const storage = globalThis.__cazoneTenantStorage || (globalThis.__cazoneTenantStorage = new AsyncLocalStorage());

// Wrap an async operation so every tenant query inside it is scoped to organizationId.
// fn is awaited INSIDE the context so a returned lazy Prisma query actually executes in-scope.
export function runWithOrg(organizationId, fn) {
  return storage.run({ organizationId: String(organizationId) }, async () => await fn());
}

// Set the scope for the remainder of the current async execution (used at the top of route
// handlers). Each request is its own async context, so this never bleeds across requests.
export function enterOrg(organizationId) {
  if (!organizationId) return;
  storage.enterWith({ organizationId: String(organizationId) });
}

// Run trusted, cross-tenant code (login lookup, /platform super-admin, migrations) unscoped.
export function runUnscoped(fn) {
  return storage.run({ unscoped: true }, async () => await fn());
}

export function getCurrentOrg() {
  return storage.getStore()?.organizationId || null;
}

// Raw store access for lib/prisma.js's query extension — not meant for use in route handlers.
export function getScope() {
  return storage.getStore();
}

// Route helper: call at the top of an authed handler (after the session check). Enters the tenant
// context for the rest of the handler and returns the org id for convenience.
export function requireOrg(session) {
  const orgId = session?.user?.organizationId;
  if (!orgId) {
    const err = new Error('No organization on this session');
    err.status = 401;
    throw err;
  }
  enterOrg(orgId);
  return orgId;
}
