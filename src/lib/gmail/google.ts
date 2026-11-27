import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { HttpError } from "../errors";
import { siteUrl } from "../site-url";
import type { GmailMessage } from "./message";

// Google sign-in (OAuth 2.0) for the profiles' Gmail inboxes, and the few Gmail API calls the daily check needs.
// Plain fetch calls: no Google SDK. Only read access to Gmail is asked for.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALLBACK_PATH = "/api/gmail/callback";

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

function clientCredentials() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new HttpError(500, "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment first.");
  return { id, secret };
}

/**
 * Where Google sends the administrator back: GOOGLE_GMAIL_REDIRECT_URI as a path (e.g. "/api/gmail/callback") on the
 * address the site is visited at, so the same setting works at http://localhost:3000 and on Vercel. A full URL there
 * is used only when it is on this site; otherwise (or when unset) this site's /api/gmail/callback. The result must be
 * listed under "Authorized redirect URIs" in the Google Cloud console (Administrator -> Gmail shows it).
 */
export function redirectUri(siteOrigin: string) {
  const configured = process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim() || CALLBACK_PATH;
  if (configured.startsWith("/")) return siteUrl(configured, siteOrigin);
  try {
    if (new URL(configured).origin === siteOrigin) return configured;
  } catch {
    // not a URL
  }
  return siteUrl(CALLBACK_PATH, siteOrigin);
}

export function consentUrl(options: { state: string; redirectUri: string; loginHint: string }) {
  const params = new URLSearchParams({
    client_id: clientCredentials().id,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    // A refresh token, so the daily check can read the inbox without anyone signed in. "consent" makes Google send a
    // new refresh token on every connect (it sends one only the first time otherwise).
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: options.state,
  });
  if (options.loginHint) params.set("login_hint", options.loginHint);
  return `${AUTH_URL}?${params}`;
}

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenReply;
  return { ok: res.ok, data };
}

/** Trades the code from Google's consent page for tokens. */
export async function exchangeCode(code: string, redirect: string) {
  const { id, secret } = clientCredentials();
  const { ok, data } = await tokenRequest({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" });
  if (!ok || !data.access_token) throw new HttpError(400, `Google did not accept the sign-in: ${data.error_description || data.error || "unknown error"}`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? "", scope: data.scope ?? "" };
}

/** Google refused the refresh token: access was removed, the password changed, or the token expired. */
export class GmailAccessError extends Error {}

/** A fresh access token (valid for an hour) from the stored refresh token. */
export async function accessToken(refreshToken: string) {
  const { id, secret } = clientCredentials();
  const { ok, data } = await tokenRequest({ refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: "refresh_token" });
  if (ok && data.access_token) return data.access_token;
  if (data.error === "invalid_grant" || data.error === "unauthorized_client") {
    throw new GmailAccessError("Google no longer accepts this connection (access removed, expired or the password changed). Reconnect it.");
  }
  throw new Error(`Google sign-in failed: ${data.error_description || data.error || "no answer"}`);
}

export async function revokeToken(token: string) {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(15_000) }).catch(() => null);
}

async function gmailGet<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = `${GMAIL}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (res.ok) return (await res.json()) as T;
    // Rate limits and Google's own hiccups: wait and try again a few times.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (res.status === 401) throw new GmailAccessError("Google refused the access token. Reconnect this Gmail.");
    if (res.status === 403) throw new GmailAccessError(`Gmail refused the request: ${data.error?.message ?? "no permission"}. Reconnect this Gmail and allow reading email.`);
    throw new Error(`Gmail API error ${res.status}: ${data.error?.message ?? res.statusText}`);
  }
}

/** The address of the signed-in Gmail account. */
export async function gmailAddress(token: string) {
  const data = await gmailGet<{ emailAddress: string }>(token, "/profile");
  return data.emailAddress.toLowerCase();
}

/** The ids of every message that fits the Gmail search `q` (newest first). */
export async function listMessageIds(token: string, q: string, limit = 5000) {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const data = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(token, "/messages", {
      q,
      maxResults: "500",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const m of data.messages ?? []) ids.push(m.id);
    pageToken = data.nextPageToken ?? "";
  } while (pageToken && ids.length < limit);
  return ids.slice(0, limit);
}

export function getMessage(token: string, id: string) {
  return gmailGet<GmailMessage>(token, `/messages/${encodeURIComponent(id)}`, { format: "full" });
}

// Refresh tokens are stored encrypted (AES-256-GCM) with a key made from SESSION_SECRET, so a database dump or backup
// alone does not give access to anyone's mail. A new SESSION_SECRET means every Gmail must be connected again.
function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  return createHash("sha256").update(`jms-gmail-token:${secret}`).digest();
}

export function sealToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
}

export function openToken(sealed: string) {
  try {
    const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new GmailAccessError("The saved Google connection cannot be read (SESSION_SECRET changed?). Reconnect this Gmail.");
  }
}
