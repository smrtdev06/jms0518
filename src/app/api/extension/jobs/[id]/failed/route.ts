import { audit, queryOne } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { assertMemberJob, extensionJson, extensionRoute, requireExtensionMember } from "@/lib/extension";
import { parseId, readJson, str } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// POST { reason } — the extension could not apply. A Ready to Apply job becomes Failed.
export const POST = extensionRoute<Ctx>(async (request, { params }) => {
  const user = await requireExtensionMember(request);
  const jobId = parseId((await params).id);
  await assertMemberJob(user.id, jobId);
  const reason = str((await readJson(request)).reason, 1000);
  if (reason.length < 3) throw new HttpError(400, "Write why applying failed");
  const row = await queryOne<{ id: number }>(
    `UPDATE jobs SET apply_status = 'failed', apply_fail_reason = $2, apply_failed_at = now(), apply_failed_by = $3, updated_at = now()
     WHERE id = $1 AND user_id = $3 AND apply_status = 'ready' RETURNING id`,
    [jobId, reason, user.id],
  );
  if (!row) throw new HttpError(409, "Only jobs that are Ready to Apply can be marked as failed");
  await audit(user.id, "job.apply_failed", "job", jobId, { reason, source: "extension" });
  return extensionJson({ ok: true, applyStatus: "failed" });
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
