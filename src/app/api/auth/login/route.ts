import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { readJson, route, str } from "@/lib/http";
import { homePath, type Role } from "@/lib/roles";
import { loginBlocked, recordLogin } from "@/lib/tailor/login-limit";

// Checked for unknown user IDs so they take as long as real ones.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export const POST = route(async (request) => {
  const body = await readJson(request);
  const username = str(body.username, 100);
  const password = String(body.password ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "Enter your user ID and password" }, { status: 400 });
  }
  // Behind a proxy that reports the client address, one address is also limited (see login-limit.ts).
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const wait = loginBlocked(username, client);
  if (wait) {
    return NextResponse.json({ error: `Too many failed sign-ins. Try again in ${Math.ceil(wait / 60)} minute(s).` }, { status: 429 });
  }

  const user = await queryOne<{ id: number; password_hash: string; role: Role; is_active: boolean }>(
    "SELECT id, password_hash, role, is_active FROM users WHERE lower(username) = lower($1)",
    [username],
  );
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  recordLogin(username, client, Boolean(user && valid));
  if (!user || !valid) return NextResponse.json({ error: "Incorrect user ID or password" }, { status: 401 });
  if (!user.is_active) return NextResponse.json({ error: "This account is deactivated" }, { status: 403 });

  await createSession(user.id);
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  return NextResponse.json({ redirect: homePath(user.role) });
});
