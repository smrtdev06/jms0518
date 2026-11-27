import { after, NextResponse } from "next/server";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { readProvider } from "@/lib/tailor/api-key";
import { loadProfile } from "@/lib/tailor/profile";
import { startGeneration } from "@/lib/tailor/runner";

// The work continues after the answer (after()); serverless hosts stop it at this many seconds.
export const maxDuration = 300;

// POST { urls: "https://...\nhttps://..." } starts a batch for the signed-in member.
export const POST = route(async (request) => {
  const user = await requireApiUser(can.tailor);
  const profile = await loadProfile(user.id);
  if (!profile) throw new HttpError(400, "Save your profile before generating.");
  const body = await readJson(request);
  const provider = readProvider();
  if (!provider.apiKey) throw new HttpError(400, `Set ${provider.keyName} in the environment before generating.`);
  const urls = [...new Set(String(body.urls || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  if (!urls.length) throw new HttpError(400, "Add at least one job URL.");
  for (const url of urls) {
    let protocol = "";
    try {
      protocol = new URL(url).protocol;
    } catch {
      // not a URL
    }
    if (protocol !== "http:" && protocol !== "https:") throw new HttpError(400, `This is not a job URL: ${url.slice(0, 200)}`);
  }
  let started;
  try {
    started = await startGeneration(user.id, profile, urls);
  } catch (error) {
    throw new HttpError(500, "Could not start generation.", { cause: error });
  }
  after(() => started.done);
  return NextResponse.json({ ok: true, jobs: started.jobs });
});
