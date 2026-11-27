import { NextResponse } from "next/server";
import { audit, queryOne } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { assertJobAccess } from "@/lib/access";
import { interviewEndedSql } from "@/lib/jobs";
import { autoAssign } from "@/lib/assign";
import { parseId, readJson, route, str } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const OUTCOMES = ["positive", "neutral", "negative"];

// PUT { outcome, note }: the result note left after the interview, by the caller who attended or a member.
// An empty note and outcome removes it.
export const PUT = route<Ctx>(async (request, { params }) => {
  const user = await requireApiUser(can.viewInterviews);
  const jobId = parseId((await params).id);
  const job = await assertJobAccess(user, jobId);
  const body = await readJson(request);
  const note = str(body.note, 4000);
  const outcome = OUTCOMES.includes(String(body.outcome)) ? String(body.outcome) : "";
  if (note && !outcome) throw new HttpError(400, "Choose how the interview went");
  const clearing = !note && !outcome;

  // A result can only be written once the interview has ended (no end time: one hour after the start;
  // no start time: the end of that day; no date: any time).
  if (!clearing) {
    const timing = await queryOne<{ ended: boolean }>(
      `SELECT (interview_date IS NULL OR ${interviewEndedSql("")}) AS ended FROM jobs WHERE id = $1`,
      [jobId],
    );
    if (timing && !timing.ended) throw new HttpError(409, "The result can be added after the interview ends");
  }

  // A new result moves a scheduled interview to "interviewed" and records who wrote it and when (one interview held,
  // counted as that user's work). Editing an existing result changes only its text: no new work is counted.
  // Removing the result moves the interview back to scheduled.
  const row = await queryOne<{ interview_status: string }>(
    `UPDATE jobs SET interview_result_outcome = $2, interview_result_note = $3,
       interview_result_at = CASE WHEN $4 THEN NULL WHEN interview_result_outcome <> '' THEN interview_result_at ELSE now() END,
       interview_result_by = CASE WHEN $4 THEN NULL WHEN interview_result_outcome <> '' THEN interview_result_by ELSE $5::int END,
       interview_status = CASE
         WHEN NOT $4 AND interview_status = 'scheduled' THEN 'interviewed'
         WHEN $4 AND interview_status = 'interviewed' THEN 'scheduled'
         ELSE interview_status END,
       updated_at = now()
     WHERE id = $1 AND apply_status = 'applied' AND interview_status <> 'unscheduled'
     RETURNING interview_status`,
    [jobId, outcome, note, clearing, user.id],
  );
  if (!row) throw new HttpError(409, "A result can be added once the interview is scheduled");
  await autoAssign(job.user_id);
  await audit(user.id, clearing ? "interview.result_removed" : "interview.result_saved", "job", jobId, clearing ? {} : { outcome });
  return NextResponse.json({ ok: true, status: row.interview_status });
});
