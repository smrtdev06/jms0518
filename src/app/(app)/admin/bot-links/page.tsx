import { query } from "@/lib/db";
import type { SearchParams } from "@/lib/jobs";
import { Pagination } from "@/components/list-controls";
import { BotLinksManager } from "./bot-links-manager";

export const metadata = { title: "Bot links · Administrator" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function BotLinksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 200);
  const size = [10, 20, 50, 100].includes(Number(first(sp.size))) ? Number(first(sp.size)) : 50;
  const params: unknown[] = [];
  let where = "";
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where = "WHERE l.job_link ILIKE $1";
  }
  const [{ total, saved }] = await query<{ total: number; saved: number }>(
    `SELECT (SELECT count(*)::int FROM job_links l ${where}) AS total, (SELECT count(*)::int FROM job_links) AS saved`,
    params,
  );
  const page = Math.min(Math.max(1, Number(first(sp.page)) || 1), Math.max(1, Math.ceil(total / size)));
  // "Tailored": how many profiles already have a job with exactly this link.
  const links = await query<{ id: number; job_link: string; created_at: string; tailored: number }>(
    `SELECT l.id, l.job_link, l.created_at::text,
       (SELECT count(DISTINCT j.user_id)::int FROM jobs j WHERE j.job_link = l.job_link) AS tailored
     FROM job_links l ${where} ORDER BY l.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    params,
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Job links the job-finding bot sent to <span className="font-mono text-xs">POST /api/job-links</span> ({saved.toLocaleString()} saved). Members pull
        them into the Resume Tailor with <span className="text-fg">Get from DB</span>.
      </p>
      <BotLinksManager links={links} q={q} total={total} saved={saved} />
      <Pagination total={total} page={page} size={size} />
    </div>
  );
}
