import { query } from "./db";

// Limits failed sign-ins: after 8 failures within 15 minutes for the same user ID, further attempts for that ID are
// refused until the window passes. One client address is also limited to 40 failures across all IDs, but only when
// the address can be trusted (see clientAddress): otherwise every visitor could look the same, or pick any address.
// Failures are kept in the database (login_failures), so the limit holds across restarts and across the many
// instances of a serverless host.

const WINDOW_MINUTES = 15;
const MAX_PER_USER = 8;
const MAX_PER_CLIENT = 40;

/**
 * The client's address from X-Forwarded-For, only where a proxy in front of the site sets that header itself: on
 * Vercel, or when TRUST_PROXY=true. Elsewhere anyone could send the header, so it is ignored.
 */
export function clientAddress(request: Request) {
  const trusted = Boolean(process.env.VERCEL) || process.env.TRUST_PROXY?.trim().toLowerCase() === "true";
  if (!trusted) return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function keys(userId: string, client: string | null) {
  const list: [string, number][] = [[`user:${userId.toLowerCase()}`, MAX_PER_USER]];
  if (client) list.push([`client:${client}`, MAX_PER_CLIENT]);
  return list;
}

/** Seconds to wait before another attempt is allowed, or 0. */
export async function loginBlocked(userId: string, client: string | null) {
  for (const [key, max] of keys(userId, client)) {
    const [row] = await query<{ n: number; wait: number | null }>(
      `SELECT count(*)::int AS n,
         ceil(extract(epoch FROM min(failed_at) + make_interval(mins => $2) - now()))::int AS wait
       FROM login_failures WHERE key = $1 AND failed_at > now() - make_interval(mins => $2)`,
      [key, WINDOW_MINUTES],
    );
    if (row.n >= max) return Math.max(1, row.wait ?? 1);
  }
  return 0;
}

export async function recordLogin(userId: string, client: string | null, success: boolean) {
  if (success) {
    await query("DELETE FROM login_failures WHERE key = $1", [`user:${userId.toLowerCase()}`]);
    return;
  }
  await query("INSERT INTO login_failures (key) SELECT unnest($1::text[])", [keys(userId, client).map(([key]) => key)]);
  // Old failures no longer count; they are removed as new ones come in.
  await query("DELETE FROM login_failures WHERE failed_at < now() - make_interval(mins => $1)", [WINDOW_MINUTES]);
}
