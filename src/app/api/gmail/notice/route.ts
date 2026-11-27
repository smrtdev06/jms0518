import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { readJson, route, str } from "@/lib/http";
import { closeNotice, noticeFor } from "@/lib/gmail/notice";

export const dynamic = "force-dynamic";

// The daily "Gmail check" notice of the signed-in user (src/lib/gmail/notice.ts).

// GET: the notice to show now, or { notice: null }.
export const GET = route(async () => {
  const user = await requireApiUser();
  return NextResponse.json({ ok: true, notice: await noticeFor(user) });
});

// POST { day }: the user closed that day's notice; it is not shown again.
export const POST = route(async (request) => {
  const user = await requireApiUser();
  const day = str((await readJson(request)).day, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "Invalid day");
  await closeNotice(user.id, day);
  return NextResponse.json({ ok: true });
});
