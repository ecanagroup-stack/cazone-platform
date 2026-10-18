// Prisma BigInt values cannot be passed directly to NextResponse.json / JSON.stringify.
// Serialize them as decimal strings so APIs preserve the exact stored integer.
export function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
