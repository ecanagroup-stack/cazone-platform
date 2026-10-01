# Cazone GS&M Platform

The multi-tenant SaaS platform: organizations, services, branches, users, roles, billing, and
business modules. The petrol station module includes pumps, attendants, shift readings,
append-only pump collections, stock reconciliation, and reports.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in a Postgres `DATABASE_URL` (Neon recommended) and
   `NEXTAUTH_SECRET` (`openssl rand -base64 32`).
3. `npx prisma migrate dev --name init`
4. `npm run seed:super-admin` — creates the first `super_admin` login from the `SEED_SUPER_ADMIN_*`
   env vars.
5. `npm run dev`, log in at `/login`, create the first organization from `/platform/organizations`.

For an existing database, run `npx prisma migrate deploy` before starting a new version. The
fuel collection migration preserves previously recorded pump payments and assigns an operating
date to existing shifts. `node scripts/verify-fuel-migration.mjs` checks those records after
migration; `node --test tests/fuelCollections.test.mjs` checks the collection rules.

See `C:\Users\mail2\.claude\plans\federated-booping-sifakis.md` for the full design/decisions behind
this repo (why Postgres/Prisma over Mongo, the Organization → Service → Branch model, tenant scoping).
