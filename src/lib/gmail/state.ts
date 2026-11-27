import "server-only";
import { SignJWT, jwtVerify } from "jose";

// The OAuth "state" sent to Google and back: which profile's Gmail is being connected, by which administrator, and
// the redirect URI used (the code must be traded with the same one). Signed, and valid for 15 minutes.

type State = { memberId: number; adminId: number; redirectUri: string };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  return new TextEncoder().encode(value);
}

export function signState(state: State) {
  return new SignJWT({ ...state, purpose: "gmail-connect" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("15m").sign(secret());
}

export async function readState(token: string): Promise<State | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.purpose !== "gmail-connect") return null;
    const { memberId, adminId, redirectUri } = payload as Record<string, unknown>;
    if (typeof memberId !== "number" || typeof adminId !== "number" || typeof redirectUri !== "string") return null;
    return { memberId, adminId, redirectUri };
  } catch {
    return null;
  }
}
