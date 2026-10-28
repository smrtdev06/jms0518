import { can, requireApiUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { route } from "@/lib/http";
import { json } from "@/lib/tailor/http";
import { normalizeJobLink } from "@/lib/normalize";

// GET: the links the job-finding bot saved (job_links table), for the Resume Tailor's "Get from DB" button.
// Links already registered on the member's profile are left out (generating would skip them anyway).
export const GET = route(async () => {
  const user = await requireApiUser(can.tailor);
  const [stored, registered] = await Promise.all([
    query<{ job_link: string }>("SELECT job_link FROM job_links ORDER BY id"),
    query<{ job_link_normalized: string }>("SELECT job_link_normalized FROM jobs WHERE user_id = $1", [user.id]),
  ]);
  const known = new Set(registered.map((row) => row.job_link_normalized));
  const links: string[] = [];
  for (const { job_link } of stored) {
    const key = normalizeJobLink(job_link);
    if (known.has(key)) continue;
    known.add(key); // the same posting saved twice with different tracking parameters
    links.push(job_link);
  }
  return json({ ok: true, links, total: stored.length, skipped: stored.length - links.length });
});
