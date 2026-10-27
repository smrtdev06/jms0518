import { NextResponse } from "next/server";
import { audit, queryOne } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { assertJobAccess } from "@/lib/access";
import { autoAssign } from "@/lib/assign";
import { parseId, readJson, route, str } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// POST { reason }: applying did not work — a "Ready to Apply" job becomes "Failed" with the reason.
export const POST = route<Ctx>(async (request, { params }) => {
  const user = await requireApiUser(can.apply);
  const jobId = parseId((await params).id);
  await assertJobAccess(user, jobId);
  const reason = str((await readJson(request)).reason, 1000);
  if (reason.length < 3) throw new HttpError(400, "Write why applying failed");
  const row = await queryOne<{ id: number }>(
    `UPDATE jobs SET apply_status = 'failed', apply_fail_reason = $2, apply_failed_at = now(), apply_failed_by = $3, updated_at = now()
     WHERE id = $1 AND apply_status = 'ready' RETURNING id`,
    [jobId, reason, user.id],
  );
  if (!row) throw new HttpError(409, "Only jobs that are Ready to Apply can be marked as failed");
  await audit(user.id, "job.apply_failed", "job", jobId, { reason });
  return NextResponse.json({ ok: true });
});

// DELETE: try again — a "Failed" job goes back to "Ready to Apply".
export const DELETE = route<Ctx>(async (_request, { params }) => {
  const user = await requireApiUser(can.apply);
  const jobId = parseId((await params).id);
  const job = await assertJobAccess(user, jobId);
  const row = await queryOne<{ id: number }>(
    `UPDATE jobs SET apply_status = 'ready', apply_fail_reason = '', apply_failed_at = NULL, apply_failed_by = NULL, updated_at = now()
     WHERE id = $1 AND apply_status = 'failed' RETURNING id`,
    [jobId],
  );
  if (!row) throw new HttpError(409, "This job is not marked as failed");
  await autoAssign(job.user_id);
  await audit(user.id, "job.apply_retry", "job", jobId);
  return NextResponse.json({ ok: true });
});
