import { query, transaction } from "./db";
import { HttpError } from "./auth";

// A member hands their jobs to the team on the Team page:
//   bidder ← jobs that are Ready to Apply (apply_status 'ready')
//   caller ← interviews that are Scheduled (interview_status 'scheduled')
// While a job is in that state it can be reassigned any number of times (even after someone worked on it);
// once applied / offered / rejected, the assignment is fixed.

export type AssignKind = "bidder" | "caller";

export type AssignableJob = {
  id: number;
  company_name: string;
  job_title: string;
  job_link: string;
  /** generated_at for bidder jobs, interview_start_at for caller jobs */
  when: string | null;
  assignee_id: number | null;
};

const COLUMN = { bidder: "assigned_bidder_id", caller: "assigned_caller_id" } as const;
const AT = { bidder: "assigned_bidder_at", caller: "assigned_caller_at" } as const;
const OPEN = {
  bidder: "j.apply_status = 'ready'",
  caller: "j.apply_status = 'applied' AND j.interview_status = 'scheduled'",
} as const;

export async function assignableJobs(memberId: number, kind: AssignKind): Promise<AssignableJob[]> {
  const rows = await query<AssignableJob>(
    `SELECT j.id, j.company_name, j.job_title, j.job_link, j.${COLUMN[kind]} AS assignee_id,
       ${kind === "bidder" ? "j.generated_at" : "j.interview_start_at"} AS "when"
     FROM jobs j
     WHERE j.user_id = $1 AND j.gen_status = 'done' AND ${OPEN[kind]}
     ORDER BY ${kind === "bidder" ? "j.generated_at DESC" : "j.interview_start_at ASC NULLS LAST"}, j.id DESC`,
    [memberId],
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return rows.map((r) => ({ ...r, when: iso(r.when) }));
}

/**
 * Makes `jobIds` exactly the open jobs of this kind assigned to `assigneeId`: listed jobs move to them,
 * their other open jobs become unassigned. Jobs that are no longer open (applied, offered, rejected …) are refused.
 */
export async function setAssignments(memberId: number, kind: AssignKind, assigneeId: number, jobIds: number[]) {
  return transaction(async (db) => {
    const { rows } = await db.query<{ id: number; open: boolean }>(
      `SELECT j.id, (j.gen_status = 'done' AND ${OPEN[kind]}) AS open FROM jobs j
       WHERE j.user_id = $1 AND j.id = ANY($2::int[]) FOR UPDATE`,
      [memberId, jobIds],
    );
    if (rows.length !== jobIds.length) throw new HttpError(404, "Job not found");
    const closed = rows.filter((r) => !r.open).length;
    if (closed) {
      throw new HttpError(
        409,
        kind === "bidder"
          ? `${closed} of these jobs are no longer Ready to Apply, so their bidder can not change`
          : `${closed} of these interviews are no longer Scheduled, so their caller can not change`,
      );
    }
    const assigned = await db.query(
      `UPDATE jobs SET ${COLUMN[kind]} = $2, ${AT[kind]} = now(), updated_at = now()
       WHERE id = ANY($1::int[]) AND ${COLUMN[kind]} IS DISTINCT FROM $2`,
      [jobIds, assigneeId],
    );
    const released = await db.query(
      `UPDATE jobs j SET ${COLUMN[kind]} = NULL, ${AT[kind]} = NULL, updated_at = now()
       WHERE j.user_id = $1 AND j.${COLUMN[kind]} = $2 AND NOT (j.id = ANY($3::int[])) AND j.gen_status = 'done' AND ${OPEN[kind]}`,
      [memberId, assigneeId, jobIds],
    );
    return { assigned: assigned.rowCount ?? 0, released: released.rowCount ?? 0 };
  });
}

/**
 * A bidder or caller who changes role or team can no longer work on their member's jobs: their unfinished
 * assignments (ready or failed applications, scheduled interviews) go back to unassigned. Finished ones stay as history.
 */
export async function releaseAssignments(userId: number) {
  await query(
    `UPDATE jobs SET assigned_bidder_id = NULL, assigned_bidder_at = NULL, updated_at = now()
     WHERE assigned_bidder_id = $1 AND apply_status IN ('ready', 'failed')`,
    [userId],
  );
  await query(
    `UPDATE jobs SET assigned_caller_id = NULL, assigned_caller_at = NULL, updated_at = now()
     WHERE assigned_caller_id = $1 AND interview_status = 'scheduled'`,
    [userId],
  );
}

/**
 * A member with exactly one active bidder (or caller) needs no choosing: every open job of that kind goes to them.
 * Called whenever jobs become open (generated, retried, scheduled …) or the team changes. Returns the jobs assigned.
 */
export async function autoAssign(memberId: number | null | undefined) {
  if (!memberId) return 0;
  let total = 0;
  for (const kind of ["bidder", "caller"] as const) {
    const rows = await query(
      `WITH sole AS (
         SELECT min(id) AS id FROM users WHERE member_id = $1 AND role = $2 AND is_active HAVING count(*) = 1
       )
       UPDATE jobs j SET ${COLUMN[kind]} = sole.id, ${AT[kind]} = now(), updated_at = now()
       FROM sole
       WHERE j.user_id = $1 AND j.gen_status = 'done' AND ${OPEN[kind]} AND j.${COLUMN[kind]} IS DISTINCT FROM sole.id
       RETURNING j.id`,
      [memberId, kind],
    );
    total += rows.length;
  }
  return total;
}

/** The bidder or caller who gets every open job automatically (the only active one of that role), if any. */
export async function soleAssignees(memberId: number) {
  const rows = await query<{ role: AssignKind; id: number }>(
    `SELECT role, min(id) AS id FROM users WHERE member_id = $1 AND role IN ('bidder', 'caller') AND is_active
     GROUP BY role HAVING count(*) = 1`,
    [memberId],
  );
  return { bidder: rows.find((r) => r.role === "bidder")?.id ?? null, caller: rows.find((r) => r.role === "caller")?.id ?? null };
}
