import { NextResponse } from "next/server";
import { can, requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { abandonGeneration } from "@/lib/tailor/runner";

// The member left the Resume Tailor before the batch finished (tab closed, reload, back button, "Leave anyway").
// Sent with navigator.sendBeacon, so it is a POST. The jobs still being generated are not kept.
export const POST = route(async () => {
  const user = await requireApiUser(can.tailor);
  const removed = await abandonGeneration(user.id);
  return NextResponse.json({ ok: true, removed });
});
