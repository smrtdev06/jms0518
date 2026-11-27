import { NextResponse } from "next/server";
import { audit, queryOne } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { parseId, route } from "@/lib/http";
import { openToken, revokeToken } from "@/lib/gmail/google";

type Ctx = { params: Promise<{ memberId: string }> };

// DELETE: disconnect the member's profile Gmail (the access is also withdrawn at Google). Interview requests already
// found stay on the jobs.
export const DELETE = route<Ctx>(async (_request, { params }) => {
  const admin = await requireApiUser(can.administer);
  const memberId = parseId((await params).memberId);
  const row = await queryOne<{ email: string; refresh_token: string }>("DELETE FROM gmail_accounts WHERE member_id = $1 RETURNING email, refresh_token", [memberId]);
  if (!row) throw new HttpError(404, "This Gmail is not connected");
  try {
    await revokeToken(openToken(row.refresh_token));
  } catch {
    // The saved token could not be read; it is deleted anyway.
  }
  await audit(admin.id, "gmail.disconnected", "users", memberId, { email: row.email });
  return NextResponse.json({ ok: true });
});
