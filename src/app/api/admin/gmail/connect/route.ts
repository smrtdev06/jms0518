import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { parseId, route } from "@/lib/http";
import { consentUrl, redirectUri } from "@/lib/gmail/google";
import { signState } from "@/lib/gmail/state";
import { siteOrigin } from "@/lib/site-url";

// GET ?member=<id>: the administrator connects that member's profile Gmail. Redirects to Google's consent page, where
// the administrator signs in to the profile's Gmail account; Google then returns to /api/gmail/callback.
export const GET = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  const url = new URL(request.url);
  const memberId = parseId(url.searchParams.get("member") ?? "");
  const member = await queryOne<{ email: string }>("SELECT email FROM users WHERE id = $1 AND role = 'member'", [memberId]);
  if (!member) throw new HttpError(404, "Member not found");
  if (!member.email.trim()) throw new HttpError(400, "This member's profile has no email yet. The member adds it in the profile first.");
  const redirect = redirectUri(siteOrigin(request.headers, request.url));
  const state = await signState({ memberId, adminId: admin.id, redirectUri: redirect });
  return NextResponse.redirect(consentUrl({ state, redirectUri: redirect, loginHint: member.email.trim() }));
});
