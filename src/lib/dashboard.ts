import { query } from "./db";

type DashboardFilter = { days: number | null; profileId: number | null };

// $1 = window start (timestamptz or null for "all time"), $2 = profile id or null.
const IN_RANGE = (col: string) => `(${col} IS NOT NULL AND ($1::timestamptz IS NULL OR ${col} >= $1))`;
// Only generated packages count as jobs (gen_status = 'done'); profile = the member the job belongs to.
const profileFilter = (n: number) => `(j.gen_status = 'done' AND ($${n}::int IS NULL OR j.user_id = $${n}))`;
const PROFILE = profileFilter(2);

export type TeamActivity = {
  id: number;
  username: string;
  name: string;
  role: "member" | "bidder" | "caller";
  is_active: boolean;
  member_id: number | null;
  member_name: string | null;
  generated: number; // resumes + cover letters generated (member)
  assigned: number; // jobs / interviews handed to a bidder or caller (member)
  applied: number; // applications submitted
  apply_failed: number; // applications marked failed
  scheduled: number; // interviews scheduled
  results: number; // interview results recorded
  decisions: number; // offered / rejected marked
  total: number;
  today: number;
  last_active: string | null;
  last_login_at: string | null;
};

// Every recorded piece of work, with who did it and when (the *_by / *_at columns of the jobs table).
const WORK = `
  SELECT user_id AS uid, 'generated' AS kind, generated_at AS at FROM jobs WHERE gen_status = 'done' AND generated_at IS NOT NULL
  UNION ALL SELECT user_id, 'assigned', assigned_bidder_at FROM jobs WHERE assigned_bidder_at IS NOT NULL
  UNION ALL SELECT user_id, 'assigned', assigned_caller_at FROM jobs WHERE assigned_caller_at IS NOT NULL
  UNION ALL SELECT applied_by, 'applied', applied_at FROM jobs WHERE applied_by IS NOT NULL AND apply_status = 'applied'
  UNION ALL SELECT apply_failed_by, 'apply_failed', apply_failed_at FROM jobs WHERE apply_failed_by IS NOT NULL
  UNION ALL SELECT interview_scheduled_by, 'scheduled', scheduled_at FROM jobs WHERE interview_scheduled_by IS NOT NULL AND scheduled_at IS NOT NULL
  UNION ALL SELECT interview_result_by, 'results', interview_result_at FROM jobs WHERE interview_result_by IS NOT NULL
  UNION ALL SELECT offered_by, 'decisions', offered_at FROM jobs WHERE offered_by IS NOT NULL
  UNION ALL SELECT rejected_by, 'decisions', rejected_at FROM jobs WHERE rejected_by IS NOT NULL`;

// Work done per user in the period. memberId limits it to one member and their team (null = everyone);
// includeMembers adds the members themselves next to their bidders and callers.
export async function teamActivity(days: number | null, memberId: number | null, includeMembers = false): Promise<TeamActivity[]> {
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  const inRange = (kind: string) => `count(*) FILTER (WHERE w.kind = '${kind}' AND ($1::timestamptz IS NULL OR w.at >= $1))::int`;
  const rows = await query<TeamActivity>(
    `WITH work AS (${WORK})
     SELECT u.id, u.username,
       -- members are shown by their profile name (as in the profile filter), others by their display name
       COALESCE(CASE WHEN u.role = 'member' THEN u.full_name END, NULLIF(u.display_name, ''), u.username) AS name, u.role, u.is_active, u.member_id,
       COALESCE(m.full_name, NULLIF(m.display_name, ''), m.username) AS member_name,
       ${inRange("generated")} AS generated,
       ${inRange("assigned")} AS assigned,
       ${inRange("applied")} AS applied,
       ${inRange("apply_failed")} AS apply_failed,
       ${inRange("scheduled")} AS scheduled,
       ${inRange("results")} AS results,
       ${inRange("decisions")} AS decisions,
       count(w.kind) FILTER (WHERE $1::timestamptz IS NULL OR w.at >= $1)::int AS total,
       count(w.kind) FILTER (WHERE w.at >= current_date)::int AS today,
       max(w.at) AS last_active,
       u.last_login_at
     FROM users u
     LEFT JOIN users m ON m.id = u.member_id
     LEFT JOIN work w ON w.uid = u.id
     WHERE (u.role IN ('bidder', 'caller') OR ($3 AND u.role = 'member'))
       AND ($2::int IS NULL OR u.member_id = $2 OR u.id = $2)
     GROUP BY u.id, m.id
     ORDER BY COALESCE(m.full_name, u.full_name, u.username), array_position(ARRAY['member', 'bidder', 'caller'], u.role), name`,
    [since, memberId, includeMembers],
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return rows.map((r) => ({ ...r, last_active: iso(r.last_active), last_login_at: iso(r.last_login_at) }));
}

export type WorkDay = { day: string; tailoring: number; assigning: number; applying: number; interviews: number };

// One user's work per day, grouped into the four kinds of work (at most the last 90 days).
export async function workDaily(days: number | null, userId: number): Promise<WorkDay[]> {
  const seriesDays = Math.min(days ?? 90, 90);
  const kind = (kinds: string[]) => `count(w.kind) FILTER (WHERE w.kind IN (${kinds.map((k) => `'${k}'`).join(", ")}))::int`;
  return query<WorkDay>(
    `WITH work AS (${WORK}),
     d AS (SELECT generate_series((current_date - ($2::int - 1)), current_date, interval '1 day')::date AS day)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
       ${kind(["generated"])} AS tailoring,
       ${kind(["assigned"])} AS assigning,
       ${kind(["applied", "apply_failed"])} AS applying,
       ${kind(["scheduled", "results", "decisions"])} AS interviews
     FROM d LEFT JOIN work w ON w.uid = $1 AND w.at::date = d.day
     GROUP BY d.day ORDER BY d.day`,
    [userId, seriesDays],
  );
}

export async function loadDashboard({ days, profileId }: DashboardFilter) {
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  const params = [since, profileId];

  const [kpis] = await query<{
    received: number;
    applied: number;
    apply_failed: number;
    waiting: number;
    scheduled: number;
    offered: number;
    rejected: number;
    upcoming: number;
    applied_total: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE ${IN_RANGE("j.generated_at")})::int AS received,
       count(*) FILTER (WHERE ${IN_RANGE("j.applied_at")})::int AS applied,
       count(*) FILTER (WHERE ${IN_RANGE("j.apply_failed_at")})::int AS apply_failed,
       count(*) FILTER (WHERE j.apply_status = 'ready')::int AS waiting,
       count(*) FILTER (WHERE ${IN_RANGE("j.scheduled_at")})::int AS scheduled,
       count(*) FILTER (WHERE ${IN_RANGE("j.offered_at")})::int AS offered,
       count(*) FILTER (WHERE ${IN_RANGE("j.rejected_at")})::int AS rejected,
       count(*) FILTER (WHERE j.interview_status = 'scheduled' AND j.interview_start_at BETWEEN now() AND now() + interval '7 days')::int AS upcoming,
       count(*) FILTER (WHERE j.apply_status = 'applied')::int AS applied_total
     FROM jobs j WHERE ${PROFILE}`,
    params,
  );

  // Daily series: at most 90 buckets; "all time" shows the last 90 days.
  const seriesDays = Math.min(days ?? 90, 90);
  const daily = await query<{ day: string; received: number; applied: number; interviews: number }>(
    `WITH d AS (
       SELECT generate_series((current_date - ($2::int - 1)), current_date, interval '1 day')::date AS day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
       (SELECT count(*) FROM jobs j WHERE j.generated_at::date = d.day AND ${profileFilter(1)})::int AS received,
       (SELECT count(*) FROM jobs j WHERE j.applied_at::date = d.day AND ${profileFilter(1)})::int AS applied,
       (SELECT count(*) FROM jobs j WHERE j.scheduled_at::date = d.day AND ${profileFilter(1)})::int AS interviews
     FROM d ORDER BY d.day`,
    [profileId, seriesDays],
  );

  const profiles = await query<{
    id: number;
    name: string;
    label: string;
    received: number;
    waiting: number;
    applied: number;
    unscheduled: number;
    scheduled: number;
    interviewed_step: number;
    offered: number;
    rejected: number;
    interviewed: number;
    last_applied: string | null;
    team_size: number;
  }>(
    `SELECT p.id, p.full_name AS name, p.profile_label AS label,
       (SELECT count(*)::int FROM users t WHERE t.member_id = p.id AND t.role IN ('bidder', 'caller')) AS team_size,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.generated_at")})::int AS received,
       count(j.id) FILTER (WHERE j.apply_status = 'ready')::int AS waiting,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")})::int AS applied,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")} AND j.interview_status = 'unscheduled')::int AS unscheduled,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")} AND j.interview_status = 'scheduled')::int AS scheduled,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")} AND j.interview_status = 'interviewed')::int AS interviewed_step,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")} AND j.interview_status = 'offered')::int AS offered,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")} AND j.interview_status = 'rejected')::int AS rejected,
       count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")} AND j.interview_status <> 'unscheduled')::int AS interviewed,
       max(j.applied_at) AS last_applied
     FROM users p
     LEFT JOIN jobs j ON j.user_id = p.id AND j.gen_status = 'done'
     WHERE p.role = 'member' AND p.full_name IS NOT NULL AND ($2::int IS NULL OR p.id = $2) AND (p.is_active OR j.id IS NOT NULL)
     GROUP BY p.id ORDER BY count(j.id) FILTER (WHERE ${IN_RANGE("j.applied_at")}) DESC, p.full_name`,
    params,
  );

  // Every bidder's and caller's work in the period (one member's team, or everyone).
  const team = await teamActivity(days, profileId, true);

  const upcoming = await query<{
    id: number;
    company_name: string;
    job_title: string;
    profile_name: string;
    interview_date: string;
    interview_start: string | null;
    interview_end: string | null;
    interview_timezone: string;
    interview_start_at: string;
    interview_note: string;
  }>(
    `SELECT j.id, j.company_name, j.job_title, p.full_name AS profile_name,
       to_char(j.interview_date, 'YYYY-MM-DD') AS interview_date,
       to_char(j.interview_start, 'HH24:MI') AS interview_start,
       to_char(j.interview_end, 'HH24:MI') AS interview_end,
       j.interview_timezone, j.interview_start_at, j.interview_note
     FROM jobs j JOIN users p ON p.id = j.user_id
     WHERE j.gen_status = 'done' AND j.interview_status = 'scheduled' AND j.interview_start_at >= now() - interval '1 hour'
       AND ($1::int IS NULL OR j.user_id = $1)
     ORDER BY j.interview_start_at LIMIT 8`,
    [profileId],
  );

  // Resume Tailor: links submitted in the period and what became of them (failed cards are deleted by Clear).
  const [tailoring] = await query<{ submitted: number; generated: number; duplicate_link: number; duplicate_company: number; failed: number; tokens: number }>(
    `SELECT count(*)::int AS submitted,
       count(*) FILTER (WHERE gen_status = 'done')::int AS generated,
       count(*) FILTER (WHERE gen_status = 'skipped' AND gen_message LIKE 'Skipped: this link%')::int AS duplicate_link,
       count(*) FILTER (WHERE gen_status = 'skipped' AND gen_message NOT LIKE 'Skipped: this link%')::int AS duplicate_company,
       count(*) FILTER (WHERE gen_status IN ('failed', 'needs_manual'))::int AS failed,
       COALESCE(sum(total_tokens), 0)::int AS tokens
     FROM jobs j
     WHERE ($1::timestamptz IS NULL OR j.created_at >= $1) AND ($2::int IS NULL OR j.user_id = $2)`,
    params,
  );

  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return {
    kpis,
    daily,
    profiles: profiles.map((p) => ({ ...p, last_applied: iso(p.last_applied) })),
    team,
    upcoming: upcoming.map((u) => ({ ...u, interview_start_at: iso(u.interview_start_at)! })),
    tailoring,
  };
}
