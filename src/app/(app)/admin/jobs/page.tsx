import { query } from "@/lib/db";
import { allProfiles } from "@/lib/access";
import { interviewEndedSql, type SearchParams } from "@/lib/jobs";
import { Pagination } from "@/components/list-controls";
import { JobsManager } from "./jobs-manager";

export const metadata = { title: "Job links · Administrator" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const GEN = ["done", "skipped", "failed", "needs_manual", "running", "queued"];

export default async function AdminJobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = {
    profile: first(sp.profile),
    gen: first(sp.gen),
    apply: first(sp.apply),
    interview: first(sp.interview),
    q: first(sp.q).trim().slice(0, 200),
  };
  const size = [10, 20, 50, 100].includes(Number(first(sp.size))) ? Number(first(sp.size)) : 20;

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (Number(filters.profile)) add("j.user_id = ?", Number(filters.profile));
  if (GEN.includes(filters.gen)) add("j.gen_status = ?", filters.gen);
  if (filters.apply === "ready" || filters.apply === "applied" || filters.apply === "failed") {
    add("j.apply_status = ?", filters.apply);
    where.push("j.gen_status = 'done'");
  }
  if (["unscheduled", "scheduled", "interviewed", "offered", "rejected"].includes(filters.interview)) {
    add("j.interview_status = ?", filters.interview);
    where.push("j.apply_status = 'applied'");
  }
  if (filters.q) {
    params.push(`%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = `$${params.length}`;
    where.push(`(j.company_name ILIKE ${n} OR j.job_title ILIKE ${n} OR j.job_link ILIKE ${n})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [{ total }] = await query<{ total: number }>(`SELECT count(*)::int AS total FROM jobs j ${whereSql}`, params);
  const page = Math.min(Math.max(1, Number(first(sp.page)) || 1), Math.max(1, Math.ceil(total / size)));
  const jobs = await query<{
    id: number;
    company_name: string;
    job_title: string;
    job_link: string;
    profile_name: string | null;
    gen_status: string;
    gen_message: string;
    apply_status: string;
    apply_fail_reason: string;
    interview_status: string;
    needs_result: boolean;
    created_at: string;
    applied_by: string | null;
    has_resume: boolean;
  }>(
    `SELECT j.id, j.company_name, j.job_title, j.job_link, COALESCE(p.full_name, p.username) AS profile_name, j.gen_status, j.gen_message,
       j.apply_status, j.apply_fail_reason, j.interview_status, j.created_at::text, COALESCE(NULLIF(u.display_name, ''), u.username) AS applied_by,
       (j.resume_name <> '') AS has_resume,
       (j.interview_status = 'scheduled' AND ${interviewEndedSql()}) AS needs_result
     FROM jobs j JOIN users p ON p.id = j.user_id LEFT JOIN users u ON u.id = j.applied_by
     ${whereSql} ORDER BY j.created_at DESC, j.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    params,
  );

  return (
    <div className="space-y-4">
      <JobsManager jobs={jobs} profiles={await allProfiles()} filters={filters} />
      <Pagination total={total} page={page} size={size} />
    </div>
  );
}
