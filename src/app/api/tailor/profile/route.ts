import { NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { loadProfile, saveProfile } from "@/lib/tailor/profile";
import { validateProfileInput } from "@/lib/tailor/prompt";

// Saves the signed-in member's resume tailor profile.
export const POST = route(async (request) => {
  const user = await requireApiUser(can.tailor);
  const body = await readJson(request);
  const existing = await loadProfile(user.id);
  // The full name is fixed once a profile exists.
  if (existing) body.fullName = existing.fullName;
  const parsed = validateProfileInput(body as Parameters<typeof validateProfileInput>[0]);
  if ("error" in parsed && parsed.error) throw new HttpError(400, parsed.error);
  if (!parsed.value) throw new HttpError(400, "Profile is incomplete.");
  try {
    await saveProfile(user.id, parsed.value);
  } catch (error) {
    throw new HttpError(500, "Could not save the profile.", { cause: error });
  }
  await audit(user.id, existing ? "profile.updated" : "profile.created", "user", user.id);
  return NextResponse.json({ ok: true });
});
