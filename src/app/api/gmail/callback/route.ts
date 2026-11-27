import { NextResponse } from "next/server";
import { audit, query, queryOne } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { exchangeCode, gmailAddress, GMAIL_SCOPE, revokeToken, sealToken } from "@/lib/gmail/google";
import { readState } from "@/lib/gmail/state";
import { sameMailbox } from "@/lib/gmail/mailbox";
import { siteOrigin } from "@/lib/site-url";

// Google returns here after the administrator allowed (or refused) access to a profile's Gmail
// (the "Authorized redirect URI" in the Google Cloud console). Always ends on Administrator -> Gmail with a message.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = siteOrigin(request.headers, request.url);
  const back = (params: Record<string, string>) => NextResponse.redirect(new URL(`/admin/gmail?${new URLSearchParams(params)}`, origin));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  if (user.role !== "admin") return back({ error: "Only an administrator can connect Gmail." });

  const state = await readState(url.searchParams.get("state") ?? "");
  if (!state || state.adminId !== user.id) return back({ error: "The Google sign-in expired or was not started here. Click Connect again." });
  const googleError = url.searchParams.get("error");
  if (googleError) return back({ error: googleError === "access_denied" ? "Access was not allowed on Google's page." : `Google answered: ${googleError}` });
  const code = url.searchParams.get("code");
  if (!code) return back({ error: "Google did not send a sign-in code. Click Connect again." });

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code, state.redirectUri);
  } catch (error) {
    return back({ error: error instanceof Error ? error.message : "Google sign-in failed." });
  }
  const fail = async (message: string) => {
    await revokeToken(tokens.refreshToken || tokens.accessToken);
    return back({ error: message });
  };
  if (!tokens.scope.split(" ").includes(GMAIL_SCOPE)) return fail("Reading Gmail was not allowed. Click Connect again and tick the Gmail permission.");
  if (!tokens.refreshToken) return fail("Google did not give lasting access. Click Connect again.");

  const member = await queryOne<{ id: number; username: string; email: string }>("SELECT id, username, email FROM users WHERE id = $1 AND role = 'member'", [
    state.memberId,
  ]);
  if (!member) return fail("That member no longer exists.");
  let address: string;
  try {
    address = await gmailAddress(tokens.accessToken);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not read the Gmail address.");
  }
  // The inbox must be the profile's own Gmail: that is where companies answer the applications.
  if (!sameMailbox(address, member.email)) {
    return fail(`You signed in to ${address}, but ${member.username}'s profile Gmail is ${member.email}. Connect again and choose ${member.email}.`);
  }

  await query(
    `INSERT INTO gmail_accounts (member_id, email, refresh_token, connected_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (member_id) DO UPDATE SET email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token, connected_by = EXCLUDED.connected_by,
       connected_at = now(), last_error = '',
       -- Another mailbox than before: read it from the start.
       synced_through = CASE WHEN gmail_accounts.email = EXCLUDED.email THEN gmail_accounts.synced_through END`,
    [member.id, address, sealToken(tokens.refreshToken), user.id],
  );
  await audit(user.id, "gmail.connected", "users", member.id, { email: address });
  return back({ connected: String(member.id) });
}
