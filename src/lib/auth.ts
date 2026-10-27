import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { queryOne } from "./db";
import { can, homePath, type Role } from "./roles";

const SESSION_COOKIE = "jms_session";
const SESSION_DAYS = 7;

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
};

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  return new TextEncoder().encode(value);
}

export async function createSession(userId: number) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// The role is re-read from the database on every request so that role changes
// and deactivations made by an administrator take effect immediately.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let uid: unknown;
  try {
    uid = (await jwtVerify(token, secret())).payload.uid;
  } catch {
    return null; // expired or tampered token
  }
  // Database errors propagate so an outage shows an error page instead of a login loop.
  const row = await queryOne<{ id: number; username: string; display_name: string; role: Role }>(
    "SELECT id, username, display_name, role FROM users WHERE id = $1 AND is_active",
    [uid],
  );
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name || row.username, role: row.role };
});

/** For pages: redirects to /login or to the user's home page when not allowed. */
export async function requirePageUser(check?: (role: Role) => boolean): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (check && !check(user.role)) redirect(homePath(user.role));
  return user;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** For route handlers: throws HttpError(401/403). */
export async function requireApiUser(check?: (role: Role) => boolean): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  if (check && !check(user.role)) throw new HttpError(403, "You do not have permission to do this");
  return user;
}

export { can };
