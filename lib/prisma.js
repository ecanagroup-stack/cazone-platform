import { PrismaClient } from '@prisma/client';
import { getScope } from './tenantScope';

// Models that carry an `organizationId` column and must never be queried/written without a tenant
// in scope. Organization itself is exempt (it IS the tenant). UserBranchAccess, PaymentAllocation,
// OrderLine and AttendantNote are exempt because they have no organizationId of their own — each is
// only ever reached via an already-scoped parent (User/Branch, Payment/Order, Order, Attendant).
const TENANT_SCOPED_MODELS = new Set([
  'Service', 'Branch', 'User', 'AuditLog',
  'Customer', 'CustomerAdjustment', 'Payment', 'Product', 'PriceGroup', 'PriceRule', 'PriceHistory', 'Notification', 'ChatMessage', 'OtpCode', 'Order',
  'StockMove', 'Delivery', 'Reconciliation', 'Shift', 'CashDeposit', 'Flag', 'Vehicle', 'Supplier',
  'Counter', 'ProvisioningRequest',
  // Fuel pack
  'Tank', 'Dispenser', 'MeterReading', 'Attendant', 'AttendantAssignment', 'PosTerminal', 'PosPayment',
]);

const FILTER_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany', 'update', 'delete',
]);

function stamp(data, organizationId) {
  if (Array.isArray(data)) return data.map((d) => (d?.organizationId ? d : { ...d, organizationId }));
  return data?.organizationId ? data : { ...data, organizationId };
}

function basePrismaClient() {
  return globalThis.__cazonePrismaBase || (globalThis.__cazonePrismaBase = new PrismaClient());
}

function buildTenantScopedClient() {
  return basePrismaClient().$extends({
    name: 'tenantScope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          args = args || {};
          if (!TENANT_SCOPED_MODELS.has(model)) return query(args);

          const store = getScope();
          if (store?.unscoped) return query(args);

          const organizationId = store?.organizationId;
          if (!organizationId) {
            throw new Error(`Tenant scope missing: ${model}.${operation} ran without an organization context`);
          }

          if (operation === 'create' || operation === 'createMany') {
            return query({ ...args, data: stamp(args.data, organizationId) });
          }
          if (operation === 'upsert') {
            return query({
              ...args,
              where: { ...args.where, organizationId },
              create: stamp(args.create, organizationId),
            });
          }
          if (FILTER_OPS.has(operation)) {
            return query({ ...args, where: { ...args.where, organizationId } });
          }
          return query(args);
        },
      },
    },
  });
}

// Cache the EXTENDED client (not just the base) on globalThis — Next.js dev hot-reload can
// re-evaluate this module, and re-extending a fresh base client every time would be harmless but
// wasteful; re-creating the base PrismaClient itself would leak connections.
const prisma = globalThis.__cazonePrisma || (globalThis.__cazonePrisma = buildTenantScopedClient());

export default prisma;
