import { NextResponse } from "next/server";
import { audit, queryOne, transaction } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { parseId, readJson, route, str } from "@/lib/http";
import { isHttpUrl, normalizeCompany, normalizeJobLink } from "@/lib/normalize";
import { appliedKey, removeJobFiles } from "@/lib/tailor/storage";
import { autoAssign } from "@/lib/assign";

type Ctx = { params: Promise<{ id: string }> };

const INTERVIEW = ["unscheduled", "scheduled", "interviewed", "offered", "rejected"];

export const GET = route<Ctx>(async (_request, { params }) => {
  await requireApiUser(can.administer);
  const id = parseId((await params).id);
  const job = await queryOne(
    "SELECT id, user_id, job_link, company_name, job_title, gen_status, apply_status, interview_status FROM jobs WHERE id = $1",
    [id],
  );
  if (!job) throw new HttpError(404, "Job not found");
  return NextResponse.json(job);
});

// Edit a generated job's company/title/link, or correct its statuses. Setting apply_status back to
// "ready" removes the applied screenshot and clears the interview.
export const PATCH = route<Ctx>(async (request, { params }) => {
  const admin = await requireApiUser(can.administer);
  const id = parseId((await params).id);
  const body = await readJson(request);
  const current = await queryOne<{ user_id: number; apply_status: string; interview_status: string; gen_status: string }>(
    "SELECT user_id, apply_status, interview_status, gen_status FROM jobs WHERE id = $1",
    [id],
  );
  if (!current) throw new HttpError(404, "Job not found");
  if (current.gen_status !== "done") throw new HttpError(409, "Only generated jobs can be edited");

  const link = str(body.job_link, 2000);
  const company = str(body.company_name, 300);
  const title = str(body.job_title, 300);
  if (!isHttpUrl(link)) throw new HttpError(400, "Job link must be an http(s) URL");
  if (!company || !title) throw new HttpError(400, "Company and job title are required");
  const applyStatus = ["ready", "applied", "failed"].includes(String(body.apply_status)) ? String(body.apply_status) : current.apply_status;
  const interviewStatus = INTERVIEW.includes(String(body.interview_status)) ? String(body.interview_status) : current.interview_status;
  if (applyStatus !== current.apply_status && applyStatus !== "ready") {
    throw new HttpError(400, "Mark a job as applied or failed on the Applying page");
  }

  await transaction(async (db) => {
    await db.query(
      `UPDATE jobs SET job_link = $2, job_link_normalized = $3, company_name = $4, company_normalized = $5, job_title = $6, updated_at = now()
       WHERE id = $1`,
      [id, link, normalizeJobLink(link), company, normalizeCompany(company) || company.toLowerCase(), title],
    );
    if (applyStatus === "ready" && current.apply_status === "applied") {
      await db.query("DELETE FROM stored_files WHERE key = $1", [appliedKey(id)]);
      await db.query("DELETE FROM interview_rounds WHERE job_id = $1", [id]);
      await db.query(
        `UPDATE jobs SET apply_status = 'ready', applied_at = NULL, applied_by = NULL, interview_status = 'unscheduled',
           interview_email = '', interview_note = '', interview_date = NULL, interview_start = NULL, interview_end = NULL,
           interview_start_at = NULL, scheduled_at = NULL, offered_at = NULL, rejected_at = NULL,
           interview_scheduled_by = NULL, offered_by = NULL, rejected_by = NULL,
           interview_result_outcome = '', interview_result_note = '', interview_result_at = NULL, interview_result_by = NULL,
           assigned_caller_id = NULL, assigned_caller_at = NULL
         WHERE id = $1`,
        [id],
      );
    } else if (applyStatus === "ready" && current.apply_status === "failed") {
      await db.query(
        "UPDATE jobs SET apply_status = 'ready', apply_fail_reason = '', apply_failed_at = NULL, apply_failed_by = NULL WHERE id = $1",
        [id],
      );
    } else if (interviewStatus !== current.interview_status && applyStatus === "applied") {
      await db.query(
        `UPDATE jobs SET interview_status = $2,
           scheduled_at = CASE WHEN $2 IN ('scheduled', 'interviewed', 'offered', 'rejected') THEN COALESCE(scheduled_at, now()) ELSE scheduled_at END,
           offered_at = CASE WHEN $2 = 'offered' THEN now() WHEN $2 IN ('unscheduled', 'scheduled', 'interviewed') THEN NULL ELSE offered_at END,
           offered_by = CASE WHEN $2 = 'offered' THEN $3::int WHEN $2 IN ('unscheduled', 'scheduled', 'interviewed') THEN NULL ELSE offered_by END,
           rejected_at = CASE WHEN $2 = 'rejected' THEN now() ELSE NULL END,
           rejected_by = CASE WHEN $2 = 'rejected' THEN $3::int ELSE NULL END
         WHERE id = $1`,
        [id, interviewStatus, admin.id],
      );
    }
  });
  await autoAssign(current.user_id);
  await audit(admin.id, "job.updated", "job", id, { applyStatus, interviewStatus });
  return NextResponse.json({ ok: true });
});

export const DELETE = route<Ctx>(async (_request, { params }) => {
  const admin = await requireApiUser(can.administer);
  const id = parseId((await params).id);
  const row = await queryOne<{ user_id: number; company_name: string; job_title: string; gen_status: string }>(
    "SELECT user_id, company_name, job_title, gen_status FROM jobs WHERE id = $1",
    [id],
  );
  if (!row) throw new HttpError(404, "Job not found");
  if (row.gen_status === "running" || row.gen_status === "queued") throw new HttpError(409, "This job is still being generated");
  await removeJobFiles([id]);
  await queryOne("DELETE FROM jobs WHERE id = $1", [id]);
  await audit(admin.id, "job.deleted", "job", id, { company: row.company_name, title: row.job_title });
  return NextResponse.json({ ok: true });
});
