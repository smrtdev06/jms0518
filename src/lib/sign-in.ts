import bcrypt from "bcryptjs";
import { queryOne } from "./db";
import { clientAddress, loginBlocked, recordLogin } from "./login-limit";
import type { Role } from "./roles";

// The password check shared by the website (POST /api/auth/login) and the extension (POST /api/extension/session).

// Checked for unknown user IDs so they take as long as real ones.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export type Account = {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
};

type SignInResult = { ok: true; account: Account } | { ok: false; status: 400 | 401 | 429; error: string };

/**
 * Checks a user ID and password, with the failed sign-in limit (see login-limit.ts). A matching account is returned
 * even when it is deactivated, so each caller can answer that case in its own way.
 */
export async function verifySignIn(request: Request, username: string, password: string): Promise<SignInResult> {
  if (!username || !password) return { ok: false, status: 400, error: "Enter your user ID and password" };
  const client = clientAddress(request);
  const wait = await loginBlocked(username, client);
  if (wait) return { ok: false, status: 429, error: `Too many failed sign-ins. Try again in ${Math.ceil(wait / 60)} minute(s).` };

  const row = await queryOne<Account & { password_hash: string }>(
    "SELECT id, username, display_name, role, is_active, password_hash FROM users WHERE lower(username) = lower($1)",
    [username],
  );
  const valid = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  await recordLogin(username, client, Boolean(row && valid));
  if (!row || !valid) return { ok: false, status: 401, error: "Incorrect user ID or password" };
  const { password_hash: _hash, ...account } = row;
  return { ok: true, account };
}
