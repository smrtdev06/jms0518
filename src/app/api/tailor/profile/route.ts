import { audit } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { json, serverError } from "@/lib/tailor/http";
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
  if ("error" in parsed && parsed.error) return json({ ok: false, error: parsed.error }, 400);
  if (!parsed.value) return json({ ok: false, error: "Profile is incomplete." }, 400);
  try {
    await saveProfile(user.id, parsed.value);
  } catch (error) {
    return serverError(error, "Could not save the profile.");
  }
  await audit(user.id, existing ? "profile.updated" : "profile.created", "user", user.id);
  return json({ ok: true });
});
