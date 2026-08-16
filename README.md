# Cazone GS&M Platform

The multi-tenant SaaS core: organizations, services (fuel station / shop / warehouse / hotel / ...),
branches per service, users, roles, and billing skeleton. No vertical business logic lives here —
this is the layer that `petrol-station-app`, `ecana_shop-app`, and a future hotel app get imported
against as vertical packs.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in a Postgres `DATABASE_URL` (Neon recommended) and
   `NEXTAUTH_SECRET` (`openssl rand -base64 32`).
3. `npx prisma migrate dev --name init`
4. `npm run seed:super-admin` — creates the first `super_admin` login from the `SEED_SUPER_ADMIN_*`
   env vars.
5. `npm run dev`, log in at `/login`, create the first organization from `/platform/organizations`.

See `C:\Users\mail2\.claude\plans\federated-booping-sifakis.md` for the full design/decisions behind
this repo (why Postgres/Prisma over Mongo, the Organization → Service → Branch model, tenant scoping).
