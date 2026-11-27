import { NextResponse } from "next/server";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { googleConfigured } from "@/lib/gmail/google";
import { syncGmail } from "@/lib/gmail/sync";

export const maxDuration = 300;

// "Check now" in Administrator -> Gmail. POST { memberId? }: checks that profile's Gmail (or every connected one) for
// about a minute. When `done` is false, the page asks again to continue where this request stopped.
export const POST = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  if (!googleConfigured()) throw new HttpError(400, "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
  const memberId = Number(body.memberId);
  const result = await syncGmail({
    deadline: Date.now() + 75_000,
    memberId: Number.isInteger(memberId) && memberId > 0 ? memberId : undefined,
    by: admin.id,
    trigger: "admin",
  });
  return NextResponse.json({ ok: true, ...result });
});
