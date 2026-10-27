import { query } from "./db";

export type SearchParams = Record<string, string | string[] | undefined>;

export type JobRow = {
  id: number;
  ats_score: number | null;
  company_name: string;
  job_title: string;
  job_link: string;
  created_at: string;
  apply_status: "ready" | "applied" | "failed";
  applied_at: string | null;
  applied_by_name: string | null;
  apply_fail_reason: string;
  apply_failed_at: string | null;
  apply_failed_by_name: string | null;
  has_image: boolean;
  has_resume: boolean;
  has_cover_letter: boolean;
  interview_status: "unscheduled" | "scheduled" | "interviewed" | "offered" | "rejected";
  interview_email: string;
  interview_note: string;
  interview_date: string | null;
  interview_start: string | null;
  interview_end: string | null;
  interview_timezone: string;
  interview_start_at: string | null;
  interview_result_outcome: "" | "positive" | "neutral" | "negative";
  interview_result_note: string;
  interview_result_at: string | null;
  interview_result_by_name: string | null;
  scheduled_at: string | null;
  scheduled_by_name: string | null;
  offered_at: string | null;
  offered_by_name: string | null;
  rejected_at: string | null;
  rejected_by_name: string | null;
  assigned_bidder_name: string | null;
  assigned_caller_name: string | null;
};

export type AssigneeFilter = { column: "assigned_bidder_id" | "assigned_caller_id"; userId: number | null };

function assigneeSql(assignee: AssigneeFilter, params: unknown[]) {
  if (assignee.userId === null) return `j.${assignee.column} IS NULL`;
  params.push(assignee.userId);
  return `j.${assignee.column} = $${params.length}`;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function readListParams(sp: SearchParams, defaultStatus: string) {
  const size = [10, 20, 50, 100].includes(Number(first(sp.size))) ? Number(first(sp.size)) : 20;
  const page = Math.max(1, Math.floor(Number(first(sp.page)) || 1));
  return {
    status: first(sp.status) || defaultStatus,
    /** the member's bidder / caller filter: "" (everyone), "none" (unassigned) or a user id */
    who: first(sp.who),
    q: first(sp.q).trim().slice(0, 200),
    page,
    size,
  };
}

const SELECT = `
  j.id, j.company_name, j.job_title, j.job_link, j.ats_score,
  j.generated_at AS created_at, j.apply_status, j.applied_at,
  COALESCE(NULLIF(u.display_name, ''), u.username) AS applied_by_name,
  j.apply_fail_reason, j.apply_failed_at, COALESCE(NULLIF(fu.display_name, ''), fu.username) AS apply_failed_by_name,
  EXISTS (SELECT 1 FROM stored_files f WHERE f.key = 'applied/' || j.id) AS has_image,
  (j.resume_name <> '') AS has_resume,
  (j.cover_name <> '') AS has_cover_letter,
  j.interview_status, j.interview_email, j.interview_note,
  to_char(j.interview_date, 'YYYY-MM-DD') AS interview_date,
  to_char(j.interview_start, 'HH24:MI') AS interview_start,
  to_char(j.interview_end, 'HH24:MI') AS interview_end,
  j.interview_timezone, j.interview_start_at,
  j.interview_result_outcome, j.interview_result_note, j.interview_result_at,
  COALESCE(NULLIF(ru.display_name, ''), ru.username) AS interview_result_by_name,
  j.scheduled_at, (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = j.interview_scheduled_by) AS scheduled_by_name,
  j.offered_at, (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = j.offered_by) AS offered_by_name,
  j.rejected_at, (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = j.rejected_by) AS rejected_by_name,
  (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = j.assigned_bidder_id) AS assigned_bidder_name,
  (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = j.assigned_caller_id) AS assigned_caller_name`;

const FROM = `
  FROM jobs j
  LEFT JOIN users u ON u.id = j.applied_by
  LEFT JOIN users fu ON fu.id = j.apply_failed_by
  LEFT JOIN users ru ON ru.id = j.interview_result_by`;

// The jobs of one profile (the member's). Members, bidders and callers each work on exactly one profile.
export async function listJobs(opts: {
  profileId: number | null;
  q: string;
  page: number;
  size: number;
  applyStatus?: "ready" | "applied" | "failed";
  interviewStatus?: string;
  /** only the jobs assigned to one bidder / caller (userId null: the unassigned ones) */
  assignee?: AssigneeFilter;
  orderBy: string;
}) {
  if (!opts.profileId) return { rows: [] as JobRow[], total: 0 };
  // Only generated packages are jobs to apply to.
  const where = ["j.user_id = $1", "j.gen_status = 'done'"];
  const params: unknown[] = [opts.profileId];
  if (opts.applyStatus) {
    params.push(opts.applyStatus);
    where.push(`j.apply_status = $${params.length}`);
  }
  if (opts.interviewStatus) {
    params.push(opts.interviewStatus);
    where.push(`j.interview_status = $${params.length}`);
  }
  if (opts.assignee) where.push(assigneeSql(opts.assignee, params));
  if (opts.q) {
    params.push(`%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(j.company_name ILIKE $${params.length} OR j.job_title ILIKE $${params.length} OR j.job_link ILIKE $${params.length})`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const [{ total }] = await query<{ total: number }>(`SELECT count(*)::int AS total FROM jobs j ${whereSql}`, params);
  const page = Math.min(opts.page, Math.max(1, Math.ceil(total / opts.size)));
  const rows = await query<JobRow>(
    `SELECT ${SELECT} ${FROM} ${whereSql} ORDER BY ${opts.orderBy} LIMIT ${opts.size} OFFSET ${(page - 1) * opts.size}`,
    params,
  );
  return { rows: rows.map(serialize), total, page };
}

// Dates must be plain strings to cross the server → client component boundary cleanly.
function serialize(row: JobRow): JobRow {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return { ...row, created_at: iso(row.created_at)!, applied_at: iso(row.applied_at), apply_failed_at: iso(row.apply_failed_at), interview_start_at: iso(row.interview_start_at), interview_result_at: iso(row.interview_result_at),
    scheduled_at: iso(row.scheduled_at), offered_at: iso(row.offered_at), rejected_at: iso(row.rejected_at) };
}

type JobCounts = Record<"ready" | "applied" | "failed" | "unscheduled" | "scheduled" | "interviewed" | "offered" | "rejected", number>;

// How many of the profile's jobs (only the ones assigned to a bidder / caller, for them) are at each step.
export async function countJobs(profileId: number | null, assignee?: AssigneeFilter) {
  const params: unknown[] = [profileId ?? 0];
  const extra = assignee ? `AND ${assigneeSql(assignee, params)}` : "";
  const [row] = await query<JobCounts>(
    `SELECT
       count(*) FILTER (WHERE apply_status = 'ready')::int AS ready,
       count(*) FILTER (WHERE apply_status = 'applied')::int AS applied,
       count(*) FILTER (WHERE apply_status = 'failed')::int AS failed,
       count(*) FILTER (WHERE apply_status = 'applied' AND interview_status = 'unscheduled')::int AS unscheduled,
       count(*) FILTER (WHERE apply_status = 'applied' AND interview_status = 'scheduled')::int AS scheduled,
       count(*) FILTER (WHERE apply_status = 'applied' AND interview_status = 'interviewed')::int AS interviewed,
       count(*) FILTER (WHERE apply_status = 'applied' AND interview_status = 'offered')::int AS offered,
       count(*) FILTER (WHERE apply_status = 'applied' AND interview_status = 'rejected')::int AS rejected
     FROM jobs j WHERE j.user_id = $1 AND j.gen_status = 'done' ${extra}`,
    params,
  );
  return row;
}
