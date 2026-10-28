import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { route } from "@/lib/http";
import { assertBotKey, extractLinks, saveLinks } from "@/lib/job-links";

const MAX_BODY = 1_000_000; // 1 MB of text

// POST: the job-finding bot sends a text with job links; every link in it is saved to job_links, links that are
// already there are skipped. Sign in with the API key (see lib/job-links.ts). The body can be:
//   plain text (Content-Type: text/plain)            "Found today:\nhttps://a.com/job/1\nhttps://b.com/job/2"
//   JSON { "text": "..." }  or  { "links": ["https://...", ...] }
export const POST = route(async (request) => {
  assertBotKey(request);
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, "The text is too large (1 MB at most)");

  let text = raw;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Request body must be valid JSON");
    }
    const value = body as { text?: unknown; links?: unknown };
    if (typeof body === "string") text = body;
    else if (typeof value?.text === "string") text = value.text;
    else if (Array.isArray(value?.links)) text = value.links.filter((l): l is string => typeof l === "string").join("\n");
    else throw new HttpError(400, 'Send { "text": "..." } or { "links": ["..."] }');
  }

  const links = extractLinks(text);
  const { saved, skipped } = await saveLinks(links);
  // Only the counts go back; the links themselves are in the job_links table.
  return NextResponse.json(
    { ok: true, received: links.length, saved, skipped },
    { status: saved ? 201 : 200 },
  );
});
