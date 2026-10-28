import { NextResponse } from "next/server";
import { audit, query } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { readJson, route, str } from "@/lib/http";
import { extractLinks, saveLinks } from "@/lib/job-links";

// The administrator's Bot links page (the job_links table the job-finding bot fills).

// POST { text }: add the links in a pasted text, like the bot does (links already saved are skipped).
export const POST = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  const body = await readJson(request);
  const links = extractLinks(str(body.text, 1_000_000));
  if (!links.length) throw new HttpError(400, "No http(s) links found in the text");
  const result = await saveLinks(links);
  await audit(admin.id, "job_links.added", "job_links", null, result);
  return NextResponse.json({ ok: true, ...result });
});

// DELETE { ids: number[] } deletes those links; { all: true } empties the table.
export const DELETE = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  const body = await readJson(request);
  let deleted: number;
  if (body.all === true) {
    deleted = (await query("DELETE FROM job_links RETURNING id")).length;
  } else {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!ids.length) throw new HttpError(400, "Select at least one link");
    deleted = (await query("DELETE FROM job_links WHERE id = ANY($1::int[]) RETURNING id", [ids])).length;
  }
  await audit(admin.id, body.all === true ? "job_links.cleared" : "job_links.deleted", "job_links", null, { deleted });
  return NextResponse.json({ ok: true, deleted });
});
