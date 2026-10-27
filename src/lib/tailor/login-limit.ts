// Limits failed sign-ins: after 8 failures within 15 minutes for the same user ID, further attempts for
// that ID are refused until the window passes. When the site runs behind a proxy that reports the
// client address (X-Forwarded-For), one address is also limited to 40 failures across all IDs.
// Without that header every visitor looks the same, so no address limit is applied (it would lock
// everyone out at once). Kept in memory; a restart resets it.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER = 8;
const MAX_PER_CLIENT = 40;

const globalForLimit = globalThis as unknown as { loginFailures?: Map<string, number[]> };

function failures() {
  if (!globalForLimit.loginFailures) globalForLimit.loginFailures = new Map();
  return globalForLimit.loginFailures;
}

function recent(key: string, now: number) {
  const list = (failures().get(key) || []).filter((at) => now - at < WINDOW_MS);
  if (list.length) failures().set(key, list);
  else failures().delete(key);
  return list;
}

function keys(userId: string, client: string | null) {
  const list: [string, number][] = [[`user:${userId.toLowerCase()}`, MAX_PER_USER]];
  if (client) list.push([`client:${client}`, MAX_PER_CLIENT]);
  return list;
}

// Seconds to wait before another attempt is allowed, or 0.
export function loginBlocked(userId: string, client: string | null) {
  const now = Date.now();
  for (const [key, max] of keys(userId, client)) {
    const list = recent(key, now);
    if (list.length >= max) return Math.ceil((list[0] + WINDOW_MS - now) / 1000);
  }
  return 0;
}

export function recordLogin(userId: string, client: string | null, success: boolean) {
  const now = Date.now();
  if (success) {
    failures().delete(`user:${userId.toLowerCase()}`);
    return;
  }
  for (const [key] of keys(userId, client)) failures().set(key, [...recent(key, now), now]);
}
