-- Applied once by npm run db:init (recorded in schema_migrations).
-- Upgrade: before rounds existed, a rescheduled interview kept its old result while Scheduled again. Move such a
-- result into the history (its old schedule is unknown). No-op once done: a Scheduled job no longer keeps a result.
WITH moved AS (
  INSERT INTO interview_rounds (job_id, round, outcome, note, result_at, result_by)
  SELECT id, 1, interview_result_outcome, interview_result_note, interview_result_at, interview_result_by
  FROM jobs WHERE interview_status = 'scheduled' AND interview_result_outcome <> ''
  RETURNING job_id
)
UPDATE jobs SET interview_result_outcome = '', interview_result_note = '', interview_result_at = NULL, interview_result_by = NULL
WHERE id IN (SELECT job_id FROM moved);
