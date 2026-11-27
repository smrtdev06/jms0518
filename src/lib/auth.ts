import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { queryOne } from "./db";
import { HttpError } from "./errors";
import { can, homePath, type Role } from "./roles";

const SESSION_COOKIE = "jms_session";
const SESSION_DAYS = 7;

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  /** this sign-in (the token's id): every sign-in is a new session */
  session: string;
};

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  return new TextEncoder().encode(value);
}

type TokenKind = "session" | "extension";

type AccountRow = { id: number; username: string; display_name: string; role: Role; password_hash: string };

// A token is tied to the password it was issued under: it carries a short fingerprint of the password hash, so
// changing a password (by the user's member, an administrator, or db:init) signs out every session and extension
// made with the old one.
function passwordStamp(passwordHash: string) {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
}

async function signToken(userId: number, kind: TokenKind) {
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!row) throw new Error(`User ${userId} does not exist`);
  return new SignJWT({ uid: userId, pw: passwordStamp(row.password_hash), ...(kind === "extension" ? { ext: true } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

// The user a token belongs to, or null when it is expired, tampered with, of the other kind, for a deactivated
// user, or from before the user's password changed. The role is read from the database every time, so role changes
// and deactivations take effect immediately. Database errors propagate (an outage is not a sign-out).
async function userFromToken(token: string, kind: TokenKind): Promise<SessionUser | null> {
  let payload: Record<string, unknown>;
  try {
    payload = (await jwtVerify(token, secret())).payload;
  } catch {
    return null;
  }
  if ((payload.ext === true) !== (kind === "extension") || typeof payload.pw !== "string") return null;
  const row = await queryOne<AccountRow>(
    "SELECT id, username, display_name, role, password_hash FROM users WHERE id = $1 AND is_active",
    [payload.uid],
  );
  if (!row || passwordStamp(row.password_hash) !== payload.pw) return null;
  return { id: row.id, username: row.username, displayName: row.display_name || row.username, role: row.role, session: String(payload.jti ?? payload.iat ?? "") };
}

export async function createSession(userId: number) {
  const token = await signToken(userId, "session");
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Bearer token for the auto-apply extension. It cannot be used as a website session, nor the other way round. */
export function createExtensionToken(userId: number) {
  return signToken(userId, "extension");
}

export function userFromExtensionToken(token: string) {
  return userFromToken(token, "extension");
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? userFromToken(token, "session") : null;
});

/** For pages: redirects to /login or to the user's home page when not allowed. */
export async function requirePageUser(check?: (role: Role) => boolean): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (check && !check(user.role)) redirect(homePath(user.role));
  return user;
}

/** For route handlers: throws HttpError(401/403). */
export async function requireApiUser(check?: (role: Role) => boolean): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  if (check && !check(user.role)) throw new HttpError(403, "You do not have permission to do this");
  return user;
}

export { can };
