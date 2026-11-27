import { after, NextResponse } from "next/server";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { parseId, readJson, route } from "@/lib/http";
import { loadProfile } from "@/lib/tailor/profile";
import { continueWithManual } from "@/lib/tailor/runner";

// The work continues after the answer (after()); serverless hosts stop it at this many seconds.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// POST { description } continues a card whose page could not be read.
export const POST = route<Ctx>(async (request, { params }) => {
  const user = await requireApiUser(can.tailor);
  const profile = await loadProfile(user.id);
  if (!profile) throw new HttpError(400, "Save your profile first.");
  const id = parseId((await params).id);
  const body = await readJson(request);
  // Job descriptions are far shorter; this keeps a pasted mistake (a whole web page) from flooding the prompt.
  const description = String(body.description || body.jobDescription || "").slice(0, 50000);
  const result = await continueWithManual(user.id, profile, id, description);
  if ("error" in result) throw new HttpError(result.status, result.error);
  after(() => result.done);
  return NextResponse.json({ ok: true });
});
