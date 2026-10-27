import { after } from "next/server";
import { can, requireApiUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { readProvider } from "@/lib/tailor/api-key";
import { json, serverError } from "@/lib/tailor/http";
import { loadProfile } from "@/lib/tailor/profile";
import { startGeneration } from "@/lib/tailor/runner";

// The work continues after the answer (after()); serverless hosts stop it at this many seconds.
export const maxDuration = 300;

// POST { urls: "https://...\nhttps://..." } starts a batch for the signed-in member.
export const POST = route(async (request) => {
  const user = await requireApiUser(can.tailor);
  const profile = await loadProfile(user.id);
  if (!profile) return json({ ok: false, error: "Save your profile before generating." }, 400);
  const body = await readJson(request);
  const provider = readProvider();
  if (!provider.apiKey) return json({ ok: false, error: `Set ${provider.keyName} in the environment before generating.` }, 400);
  const urls = [...new Set(String(body.urls || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  if (!urls.length) return json({ ok: false, error: "Add at least one job URL." }, 400);
  for (const url of urls) {
    try {
      const target = new URL(url);
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("bad");
    } catch {
      return json({ ok: false, error: `This is not a job URL: ${url.slice(0, 200)}` }, 400);
    }
  }
  try {
    const { jobs, done } = await startGeneration(user.id, profile, urls);
    after(() => done);
    return json({ ok: true, jobs });
  } catch (error) {
    return serverError(error, "Could not start generation.");
  }
});
