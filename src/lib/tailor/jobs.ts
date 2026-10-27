import type { JobLog, JobRecord, JobStatus, JobStep } from "./types";
import type { PackageSnapshot } from "./pack";
import { query } from "@/lib/db";
import { normalizeJobLink } from "@/lib/normalize";
import { autoAssign } from "@/lib/assign";

// The Resume Tailor board: the jobs of one user's current batch (on_board), in pasted order.
// Finished jobs stay in the jobs table after Clear, so Applying Management keeps them.

type JobRow = {
  id: number;
  board_position: number;
  job_link: string;
  gen_status: JobStatus;
  gen_step: JobStep | null;
  gen_message: string;
  company_name: string;
  job_title: string;
  gen_error: string;
  ats_score: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  gen_logs: JobLog[];
  zip_name: string;
  resume_name: string;
  cover_name: string;
};

const COLUMNS = `id, board_position, job_link, gen_status, gen_step, gen_message, company_name, job_title, gen_error, ats_score,
  prompt_tokens, completion_tokens, total_tokens, cached_tokens, gen_logs, zip_name, resume_name, cover_name`;

function toJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    position: row.board_position,
    url: row.job_link,
    status: row.gen_status,
    step: row.gen_step,
    message: row.gen_message || "",
    company: row.company_name || "",
    jobTitle: row.job_title || "",
    error: row.gen_error || "",
    atsScore: row.ats_score,
    usage: row.total_tokens === null && row.prompt_tokens === null ? null : {
      prompt: row.prompt_tokens || 0,
      completion: row.completion_tokens || 0,
      total: row.total_tokens || (row.prompt_tokens || 0) + (row.completion_tokens || 0),
      cached: row.cached_tokens || 0,
    },
    logs: Array.isArray(row.gen_logs) ? row.gen_logs : [],
    zipName: row.zip_name || "",
    resumeName: row.resume_name || "",
    coverName: row.cover_name || "",
  };
}

export async function listJobs(userPk: number) {
  const rows = await query<JobRow>(`SELECT ${COLUMNS} FROM jobs WHERE user_id = $1 AND on_board ORDER BY board_position`, [userPk]);
  return rows.map(toJob);
}

export async function getJob(userPk: number, jobId: number) {
  const rows = await query<JobRow>(`SELECT ${COLUMNS} FROM jobs WHERE user_id = $1 AND id = $2`, [userPk, jobId]);
  return rows[0] ? toJob(rows[0]) : null;
}

// Takes the current batch off the board. Jobs that never finished are deleted (with their files);
// finished ones stay for Applying Management. Returns the ids of the deleted jobs.
export async function clearJobs(userPk: number) {
  const removed = await query<{ id: number }>(
    "DELETE FROM jobs WHERE user_id = $1 AND on_board AND gen_status NOT IN ('done', 'skipped') RETURNING id",
    [userPk],
  );
  await query("UPDATE jobs SET on_board = FALSE WHERE user_id = $1 AND on_board", [userPk]);
  return removed.map((row) => row.id);
}

// Deletes the cards that are still waiting or being generated (the member left mid-batch). Returns their ids.
export async function deleteUnfinishedJobs(userPk: number) {
  const rows = await query<{ id: number }>(
    "DELETE FROM jobs WHERE user_id = $1 AND on_board AND gen_status IN ('queued', 'running') RETURNING id",
    [userPk],
  );
  return rows.map((row) => row.id);
}

// Deletes the board's failed cards (failed, or waiting for a pasted description). Returns their ids.
export async function deleteFailedJobs(userPk: number) {
  const rows = await query<{ id: number }>(
    "DELETE FROM jobs WHERE user_id = $1 AND on_board AND gen_status IN ('failed', 'needs_manual') RETURNING id",
    [userPk],
  );
  return rows.map((row) => row.id);
}

// Adds all cards of a batch in one statement and returns them with their new ids.
export async function insertJobs(userPk: number, jobs: { position: number; url: string }[]) {
  if (!jobs.length) return [];
  return query<{ id: number; url: string; position: number }>(
    `INSERT INTO jobs (user_id, board_position, job_link, job_link_normalized, gen_status, gen_message)
     SELECT $1, position, url, normalized, 'queued', 'Waiting to start'
     FROM UNNEST($2::int[], $3::text[], $4::text[]) AS item(position, url, normalized)
     RETURNING id, job_link AS url, board_position AS position`,
    [userPk, jobs.map((job) => job.position), jobs.map((job) => job.url), jobs.map((job) => normalizeJobLink(job.url))],
  );
}

export async function updateJob(userPk: number, jobId: number, patch: Partial<{
  status: JobStatus;
  step: JobStep | null;
  message: string;
  company: string;
  companyNormalized: string;
  jobTitle: string;
  error: string;
  atsScore: number | null;
  usage: { prompt: number; completion: number; total: number; cached: number } | null;
  logs: JobLog[];
  zipName: string;
  resumeName: string;
  coverName: string;
  tailored: PackageSnapshot;
}>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    gen_status: patch.status,
    gen_step: patch.step,
    gen_message: patch.message,
    company_name: patch.company,
    company_normalized: patch.companyNormalized,
    job_title: patch.jobTitle,
    gen_error: patch.error,
    ats_score: patch.atsScore,
    prompt_tokens: patch.usage === undefined ? undefined : patch.usage?.prompt ?? null,
    completion_tokens: patch.usage === undefined ? undefined : patch.usage?.completion ?? null,
    total_tokens: patch.usage === undefined ? undefined : patch.usage?.total ?? null,
    cached_tokens: patch.usage === undefined ? undefined : patch.usage?.cached ?? null,
    gen_logs: patch.logs ? JSON.stringify(patch.logs) : undefined,
    zip_name: patch.zipName,
    resume_name: patch.resumeName,
    cover_name: patch.coverName,
    tailored: patch.tailored ? JSON.stringify(patch.tailored) : undefined,
  };
  for (const [column, value] of Object.entries(map)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}${column === "gen_logs" || column === "tailored" ? "::jsonb" : ""}`);
  }
  if (!sets.length) return;
  // A finished package becomes a "Ready to Apply" job.
  if (patch.status === "done") sets.push("generated_at = COALESCE(generated_at, now())");
  sets.push("updated_at = now()");
  values.push(userPk, jobId);
  await query(`UPDATE jobs SET ${sets.join(", ")} WHERE user_id = $${values.length - 1} AND id = $${values.length}`, values);
  // A member with a single bidder hands the new job to them right away.
  if (patch.status === "done") await autoAssign(userPk);
}

// Jobs left queued or running by a server that stopped are marked failed once per server start.
const globalForRecovery = globalThis as unknown as { tailorRecovered?: Promise<void> };
export function recoverInterruptedJobs() {
  if (!globalForRecovery.tailorRecovered) {
    globalForRecovery.tailorRecovered = query(
      `UPDATE jobs SET gen_status = 'failed',
         gen_error = 'Generation stopped because the server restarted.',
         gen_message = 'Generation stopped because the server restarted.'
       WHERE gen_status IN ('queued', 'running') AND updated_at < now() - interval '10 seconds'`,
    ).then(
      () => undefined,
      (error) => {
        globalForRecovery.tailorRecovered = undefined;
        throw error;
      },
    );
  }
  return globalForRecovery.tailorRecovered;
}

// ---------- Serverless processing (see runner.ts) ----------

// A job whose request was stopped by the host's time limit never finishes; after this long it is marked failed.
const CLAIM_TIMEOUT_SECONDS = 330;

// Takes the user's next queued job, unless `limit` jobs are already running. SKIP LOCKED keeps two requests
// from taking the same job.
export async function claimNextJob(userPk: number, limit: number) {
  const rows = await query<{ id: number; url: string }>(
    `UPDATE jobs SET gen_status = 'running', claimed_at = now(), gen_step = 'scrape', gen_message = 'Opening the job page', gen_error = ''
     WHERE id = (
       SELECT id FROM jobs WHERE user_id = $1 AND on_board AND gen_status = 'queued' ORDER BY board_position LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     AND (SELECT COUNT(*) FROM jobs WHERE user_id = $1 AND on_board AND gen_status = 'running') < $2
     RETURNING id, job_link AS url`,
    [userPk, limit],
  );
  return rows[0] || null;
}

// Takes a job that waits for a pasted description (or failed), so a double click cannot run it twice.
export async function claimForManual(userPk: number, jobId: number) {
  const rows = await query<{ id: number }>(
    `UPDATE jobs SET gen_status = 'running', claimed_at = now(), gen_step = 'extract', gen_message = 'Using the pasted job description', gen_error = ''
     WHERE user_id = $1 AND id = $2 AND gen_status IN ('needs_manual', 'failed')
     RETURNING id`,
    [userPk, jobId],
  );
  return rows.length > 0;
}

// False once the job was cleared, replaced by a new batch, or timed out.
export async function jobStillRunning(userPk: number, jobId: number) {
  const rows = await query("SELECT 1 FROM jobs WHERE user_id = $1 AND id = $2 AND on_board AND gen_status = 'running'", [userPk, jobId]);
  return rows.length > 0;
}

export async function failTimedOutJobs(userPk: number) {
  const message = "This link took longer than the server allows for one request. Try it again.";
  await query(
    `UPDATE jobs SET gen_status = 'failed', gen_message = $2, gen_error = $2
     WHERE user_id = $1 AND gen_status = 'running' AND claimed_at < now() - make_interval(secs => $3)`,
    [userPk, message, CLAIM_TIMEOUT_SECONDS],
  );
}
