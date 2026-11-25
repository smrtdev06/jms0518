import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db";
import { extensionJson, extensionRoute, issueMemberToken, presentUser } from "@/lib/extension";
import { readJson, str } from "@/lib/http";
import { loginBlocked, recordLogin } from "@/lib/tailor/login-limit";
import type { Role } from "@/lib/roles";

// Checked for unknown user IDs so they take as long as real ones.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

type Account = {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  password_hash: string;
};

// POST /api/extension/session — the extension signs in with the same user ID and password as the site.
// A success body is returned only for an active member. Other roles are confirmed, but not signed in.
export const POST = extensionRoute(async (request) => {
  const body = await readJson(request);
  const username = str(body.username ?? body.userId ?? body.user_id, 100);
  const password = String(body.password ?? "");
  if (!username || !password) return extensionJson({ ok: false, exists: false, error: "Enter your user ID and password" }, 400);

  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const wait = loginBlocked(username, client);
  if (wait) {
    return extensionJson({ ok: false, exists: false, error: `Too many failed sign-ins. Try again in ${Math.ceil(wait / 60)} minute(s).` }, 429);
  }

  const account = await queryOne<Account>(
    "SELECT id, username, display_name, role, is_active, password_hash FROM users WHERE lower(username) = lower($1)",
    [username],
  );
  const valid = await bcrypt.compare(password, account?.password_hash ?? DUMMY_HASH);
  recordLogin(username, client, Boolean(account && valid));
  if (!account || !valid) return extensionJson({ ok: false, exists: false, error: "Incorrect user ID or password" }, 401);

  const user = presentUser({
    id: account.id,
    username: account.username,
    displayName: account.display_name || account.username,
    role: account.role,
    active: account.is_active,
  });
  if (!account.is_active) {
    return extensionJson({ ok: false, exists: true, role: account.role, user, error: "This account is deactivated" }, 403);
  }
  if (account.role !== "member") {
    return extensionJson({ ok: false, exists: true, role: account.role, user, error: "Only a member can use the auto-apply extension" }, 403);
  }
  return extensionJson({ ok: true, exists: true, role: account.role, token: await issueMemberToken(account.id), user });
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
