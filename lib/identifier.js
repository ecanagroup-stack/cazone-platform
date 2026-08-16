// Shared by app/api/admin/users/route.js (invite) and app/api/username-check/route.js (live
// availability) — the same login-identifier fields (email/username/phone) are globally unique
// across the whole platform (see schema's @unique on each), so both need to agree on which field
// a given string resolves to.
export function classifyIdentifier(raw) {
  const trimmed = (raw || '').trim();
  const isEmail = trimmed.includes('@');
  const isPhone = /^\+?\d[\d\s-]{6,}$/.test(trimmed);
  const field = isEmail ? 'email' : isPhone ? 'phone' : 'username';
  // Login (lib/auth.js) always lowercases the identifier it searches with — store/check the same way.
  return { field, value: trimmed.toLowerCase() };
}
