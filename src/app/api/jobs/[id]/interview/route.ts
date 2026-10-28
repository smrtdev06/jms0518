import { NextResponse } from "next/server";
import { audit, transaction } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { assertJobAccess } from "@/lib/access";
import { autoAssign } from "@/lib/assign";
import { parseId, readJson, route, str } from "@/lib/http";
import { TIMEZONES, zonedToUtc } from "@/lib/timezones";

type Ctx = { params: Promise<{ id: string }> };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

// PUT: save the interview details. Any detail present => Scheduled; all cleared => Unscheduled.
// An Interviewed job goes back to Scheduled only when its date, time or timezone changes (the next round: its result
// moves into interview_rounds) — editing just the email or note keeps it Interviewed. Offered is kept; Rejected can no longer be edited.
// (A Scheduled interview whose time has passed shows as "Needs Result" until the caller adds the result.)
export const PUT = route<Ctx>(async (request, { params }) => {
  const user = await requireApiUser(can.editInterviews);
  const jobId = parseId((await params).id);
  const job = await assertJobAccess(user, jobId);
  if (job.apply_status !== "applied") throw new HttpError(409, "Only applied jobs have interviews");

  const body = await readJson(request);
  const email = str(body.email, 2000);
  const note = str(body.note, 2000);
  const date = str(body.date, 10);
  const start = str(body.start_time, 8);
  const end = str(body.end_time, 8);
  const timezone = str(body.timezone, 64) || "America/New_York";

  if (date && !DATE.test(date)) throw new HttpError(400, "Date must be YYYY-MM-DD");
  if (start && !TIME.test(start)) throw new HttpError(400, "Start time must be HH:MM");
  if (end && !TIME.test(end)) throw new HttpError(400, "End time must be HH:MM");
  if (start && end && end <= start) throw new HttpError(400, "End time must be after start time");
  if (!(TIMEZONES as readonly string[]).includes(timezone)) throw new HttpError(400, "Unknown timezone");

  const hasInfo = Boolean(email || note || date || start || end);
  const startAt = date ? zonedToUtc(date, start || "00:00", timezone) : null;

  await transaction(async (db) => {
    const { rows } = await db.query(
      `SELECT interview_status, COALESCE(to_char(interview_date, 'YYYY-MM-DD'), '') AS date,
         COALESCE(to_char(interview_start, 'HH24:MI'), '') AS start, COALESCE(to_char(interview_end, 'HH24:MI'), '') AS "end", interview_timezone AS timezone
       FROM jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    const current = rows[0].interview_status as string;
    // Rejected is final: its details can no longer change (the result note still can).
    if (current === "rejected") throw new HttpError(409, "A rejected interview can no longer be edited");
    const was = rows[0] as { date: string; start: string; end: string; timezone: string };
    const rescheduled = was.date !== date || was.start !== start.slice(0, 5) || was.end !== end.slice(0, 5) || was.timezone !== timezone;
    const next =
      current === "offered" ? current : !hasInfo ? "unscheduled" : current === "interviewed" && !rescheduled ? "interviewed" : "scheduled";
    // The next round: the finished round (its schedule and result) goes into the history, and the job starts the
    // new round without a result, so the caller writes a new one.
    const archived = current === "interviewed" && next !== "interviewed";
    if (archived) {
      await db.query(
        `INSERT INTO interview_rounds (job_id, round, interview_date, interview_start, interview_end, interview_timezone, outcome, note, result_at, result_by)
         SELECT id, (SELECT COUNT(*) + 1 FROM interview_rounds WHERE job_id = $1), interview_date, interview_start, interview_end, interview_timezone,
           interview_result_outcome, interview_result_note, interview_result_at, interview_result_by
         FROM jobs WHERE id = $1`,
        [jobId],
      );
    }
    await db.query(
      `UPDATE jobs SET interview_email = $2, interview_note = $3, interview_date = $4, interview_start = $5,
         interview_end = $6, interview_timezone = $7, interview_start_at = $8, interview_status = $9,
         scheduled_at = CASE WHEN $9 = 'scheduled' THEN COALESCE(scheduled_at, now()) ELSE scheduled_at END,
         -- who scheduled / last edited the interview details (cleared with the details)
         interview_scheduled_by = CASE WHEN $9 = 'unscheduled' THEN NULL ELSE $10::int END,
         interview_result_outcome = CASE WHEN $11 THEN '' ELSE interview_result_outcome END,
         interview_result_note = CASE WHEN $11 THEN '' ELSE interview_result_note END,
         interview_result_at = CASE WHEN $11 THEN NULL ELSE interview_result_at END,
         interview_result_by = CASE WHEN $11 THEN NULL ELSE interview_result_by END,
         updated_at = now()
       WHERE id = $1`,
      [jobId, email, note, date || null, start || null, end || null, timezone, startAt, next, user.id, archived],
    );
  });
  await autoAssign(job.user_id);
  await audit(user.id, "interview.updated", "job", jobId, { date, start, end, timezone });
  return NextResponse.json({ ok: true });
});

// POST: the Offered → Rejected button. Interviewed → Offered (a result note is required first), Offered → Rejected.
export const POST = route<Ctx>(async (_request, { params }) => {
  const user = await requireApiUser(can.editInterviews);
  const jobId = parseId((await params).id);
  await assertJobAccess(user, jobId);

  const next = await transaction(async (db) => {
    const { rows } = await db.query("SELECT apply_status, interview_status FROM jobs WHERE id = $1 FOR UPDATE", [jobId]);
    const { apply_status, interview_status } = rows[0];
    if (apply_status !== "applied") throw new HttpError(409, "Only applied jobs have interviews");
    if (interview_status === "unscheduled") throw new HttpError(409, "Schedule the interview first");
    if (interview_status === "scheduled") throw new HttpError(409, "Add the interview result first");
    if (interview_status === "rejected") throw new HttpError(409, "This interview is already rejected");
    const status = interview_status === "interviewed" ? "offered" : "rejected";
    await db.query(
      `UPDATE jobs SET interview_status = $2,
         offered_at = CASE WHEN $2 = 'offered' THEN now() ELSE offered_at END,
         offered_by = CASE WHEN $2 = 'offered' THEN $3::int ELSE offered_by END,
         rejected_at = CASE WHEN $2 = 'rejected' THEN now() ELSE rejected_at END,
         rejected_by = CASE WHEN $2 = 'rejected' THEN $3::int ELSE rejected_by END,
         updated_at = now()
       WHERE id = $1`,
      [jobId, status, user.id],
    );
    return status;
  });
  await audit(user.id, `interview.${next}`, "job", jobId);
  return NextResponse.json({ ok: true, status: next });
});
