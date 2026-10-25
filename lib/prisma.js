import { Prisma, PrismaClient } from '@prisma/client';
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
  'FuelCollection', 'FuelTankDip',
  'LegacyFuelRecord',
  // Petroleum distributor add-on
  'PetroleumAtc',
]);

const FILTER_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany', 'update', 'delete',
]);

// The database stores every monetary scalar as PostgreSQL BIGINT. Most existing business rules
// still do their arithmetic in JavaScript numbers, so adapt safe integer inputs/outputs at the
// Prisma boundary. Values outside Number's exact range remain decimal strings on reads and are
// rejected on number-based writes instead of being silently rounded.
const MODEL_FIELDS = new Map(Prisma.dmmf.datamodel.models.map((model) => [
  model.name,
  new Map(model.fields.map((field) => [field.name, field])),
]));

function toDatabaseBigInt(value) {
  // Prisma also uses booleans in select/include and strings such as "asc"/"desc" in orderBy
  // for a BigInt field; those are query metadata, not monetary input.
  if (value == null || typeof value === 'bigint' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Monetary amount must be a safe integer');
    return BigInt(value);
  }
  if (typeof value === 'string') return /^-?\d+$/.test(value) ? BigInt(value) : value;
  if (Array.isArray(value)) return value.map(toDatabaseBigInt);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toDatabaseBigInt(item)]));
  }
  throw new Error('Monetary amount must be an integer');
}

function normalizeModelInput(value, modelName) {
  if (Array.isArray(value)) return value.map((item) => normalizeModelInput(item, modelName));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;

  const fields = MODEL_FIELDS.get(modelName);
  if (!fields) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const field = fields.get(key);
    if (field?.kind === 'scalar' && field.type === 'BigInt') return [key, toDatabaseBigInt(item)];
    if (field?.kind === 'object') return [key, normalizeModelInput(item, field.type)];
    // Prisma operation wrappers (data, where, create, update, increment, etc.) are not model
    // fields, so keep walking them with the current model's field map.
    return [key, normalizeModelInput(item, modelName)];
  }));
}

function normalizeBigIntOutput(value) {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(normalizeBigIntOutput);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeBigIntOutput(item)]));
  }
  return value;
}

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
          args = normalizeModelInput(args || {}, model);
          if (!TENANT_SCOPED_MODELS.has(model)) return normalizeBigIntOutput(await query(args));

          const store = getScope();
          if (store?.unscoped) return normalizeBigIntOutput(await query(args));

          const organizationId = store?.organizationId;
          if (!organizationId) {
            throw new Error(`Tenant scope missing: ${model}.${operation} ran without an organization context`);
          }

          if (operation === 'create' || operation === 'createMany') {
            return normalizeBigIntOutput(await query({ ...args, data: stamp(args.data, organizationId) }));
          }
          if (operation === 'upsert') {
            return normalizeBigIntOutput(await query({
              ...args,
              where: { ...args.where, organizationId },
              create: stamp(args.create, organizationId),
            }));
          }
          if (FILTER_OPS.has(operation)) {
            return normalizeBigIntOutput(await query({ ...args, where: { ...args.where, organizationId } }));
          }
          return normalizeBigIntOutput(await query(args));
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
