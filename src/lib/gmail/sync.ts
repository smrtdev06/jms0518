import { audit, query, queryOne } from "../db";
import { analyzeEmail } from "./analyze";
import { isInterviewRequest, type EmailAnalysis } from "./analysis";
import { accessToken, getMessage, GmailAccessError, googleConfigured, listMessageIds, openToken } from "./google";
import { gmailLink, sameMailbox } from "./mailbox";
import { matchJob, type CandidateJob } from "./match";
import { readMessage } from "./message";

// The Gmail check (the daily cron job, /api/cron/sync; also "Check now" in Administrator -> Gmail).
// For every connected profile Gmail: list the emails received since the last check, have the AI analyze each new one,
// keep only interview scheduling emails, find the job each is about, mark that job "Request Schedule" (email link,
// received time). Each finished check is recorded (gmail_check_runs) for the daily notice (summary.ts). Each email is
// analyzed once (gmail_messages). A check that runs out of time
// stops cleanly; the next check continues where it stopped.

const CONCURRENCY = 4;

export type AccountReport = {
  memberId: number;
  email: string;
  status: "done" | "partial" | "skipped" | "error";
  /** emails analyzed in this run */
  checked: number;
  requests: number;
  matched: number;
  unmatched: number;
  /** new emails not reached before the time ran out */
  left: number;
  failed: number;
  tokens: number;
  error?: string;
  at: string;
};

type AccountRow = {
  member_id: number;
  email: string;
  refresh_token: string;
  synced_through: Date | null;
  profile_email: string;
  full_name: string | null;
  display_name: string;
  is_active: boolean;
};

/** How many days back the first check of a newly connected Gmail reads (GMAIL_FIRST_SYNC_DAYS, 1-90, default 14). */
function firstSyncDays() {
  const days = Math.floor(Number(process.env.GMAIL_FIRST_SYNC_DAYS));
  return days >= 1 && days <= 90 ? days : 14;
}

/**
 * Checks the connected inboxes until `deadline` (ms since epoch). `memberId`: only that profile's Gmail.
 * `onlyDue`: only inboxes not fully checked in the last 23 hours (the scheduler of a long-running server).
 */
export async function syncGmail(options: {
  deadline: number;
  memberId?: number;
  onlyDue?: boolean;
  by?: number | null;
  /** what started the check, kept with its record */
  trigger: "cron" | "scheduler" | "admin";
}) {
  if (!googleConfigured()) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to check Gmail.");
  const params: unknown[] = [];
  const where = ["u.role = 'member'"];
  if (options.memberId) {
    params.push(options.memberId);
    where.push(`g.member_id = $${params.length}`);
  }
  if (options.onlyDue) where.push("(g.last_sync_at IS NULL OR g.last_sync_at < now() - interval '23 hours')");
  const accounts = await query<{ member_id: number }>(
    `SELECT g.member_id FROM gmail_accounts g JOIN users u ON u.id = g.member_id WHERE ${where.join(" AND ")}
     ORDER BY g.last_sync_at ASC NULLS FIRST`,
    params,
  );
  const reports: AccountReport[] = [];
  for (const { member_id } of accounts) {
    if (Date.now() > options.deadline - 15_000) {
      reports.push(emptyReport(member_id, "", "partial", "Not reached before the time ran out; checked next time."));
      continue;
    }
    reports.push(await syncAccount(member_id, options.deadline));
  }
  const done = reports.every((r) => r.status !== "partial");
  if (reports.some((r) => r.checked)) {
    const total = (key: "checked" | "requests" | "matched") => reports.reduce((sum, r) => sum + r[key], 0);
    await audit(options.by ?? null, "gmail.checked", "gmail", null, { accounts: reports.length, checked: total("checked"), requests: total("requests"), matched: total("matched") });
  }
  // The record the daily "Gmail check" notice is built from (only inboxes that were really read).
  const read = reports.filter((r) => r.status !== "skipped" || r.error !== "Another check is reading this inbox right now.");
  if (read.length) {
    await query("INSERT INTO gmail_check_runs (trigger, done, reports) VALUES ($1, $2, $3)", [options.trigger, done, JSON.stringify(read)]);
  }
  return { done, accounts: reports };
}

function emptyReport(memberId: number, email: string, status: AccountReport["status"], error?: string): AccountReport {
  return { memberId, email, status, checked: 0, requests: 0, matched: 0, unmatched: 0, left: 0, failed: 0, tokens: 0, error, at: new Date().toISOString() };
}

async function syncAccount(memberId: number, deadline: number): Promise<AccountReport> {
  // Claim the inbox (another check may be reading it; a claim older than 15 minutes is from a check that died).
  const account = await queryOne<AccountRow>(
    `UPDATE gmail_accounts g SET sync_started_at = now()
     FROM users u WHERE u.id = g.member_id AND g.member_id = $1
       AND (g.sync_started_at IS NULL OR g.sync_started_at < now() - interval '15 minutes')
     RETURNING g.member_id, g.email, g.refresh_token, g.synced_through, u.email AS profile_email, u.full_name, u.display_name, u.is_active`,
    [memberId],
  );
  if (!account) return emptyReport(memberId, "", "skipped", "Another check is reading this inbox right now.");

  const report = emptyReport(memberId, account.email, "done");
  let cursor: Date | null = null;
  let fullPass = false;
  try {
    if (!account.is_active) throw new SkipError("The member is deactivated.");
    if (!sameMailbox(account.profile_email, account.email)) {
      throw new GmailAccessError(
        `The profile's Gmail is now ${account.profile_email || "empty"}, but ${account.email} is connected. Connect the profile's Gmail again.`,
      );
    }
    const token = await accessToken(openToken(account.refresh_token));
    const runStart = new Date();
    // Overlap the last check by two days: Gmail can file an email a little late. Emails already analyzed are skipped.
    const since = account.synced_through
      ? new Date(account.synced_through.getTime() - 2 * 86_400_000)
      : new Date(runStart.getTime() - firstSyncDays() * 86_400_000);
    const ids = await listMessageIds(token, `after:${Math.floor(since.getTime() / 1000)} -in:sent -in:drafts -in:chats`);
    const seen = new Set(
      (await query<{ message_id: string }>("SELECT message_id FROM gmail_messages WHERE member_id = $1 AND message_id = ANY($2::text[])", [memberId, ids])).map(
        (r) => r.message_id,
      ),
    );
    const todo = ids.filter((id) => !seen.has(id));
    const jobs = await query<CandidateJob>(
      "SELECT id, company_name, job_title, job_link, apply_status, applied_at FROM jobs WHERE user_id = $1 AND gen_status = 'done'",
      [memberId],
    );
    const candidate = { name: account.full_name || account.display_name, email: account.email };
    // The oldest email that failed: the next check must start before it.
    let oldestFailure: number | null = null;
    let next = 0;
    // Google refused the connection: every worker stops, and the whole check is reported as an error.
    let fatal: unknown = null;

    const worker = async () => {
      while (next < todo.length && Date.now() < deadline - 20_000) {
        const id = todo[next++];
        let received: number | null = null;
        try {
          const email = readMessage(await getMessage(token, id));
          received = email.receivedAt.getTime();
          // The inbox owner's own emails need no analysis.
          if (sameMailbox(email.fromEmail, account.email)) {
            await saveMessage(memberId, email, "own", null, null);
            continue;
          }
          const { analysis, tokens } = await analyzeEmail(email, candidate, AbortSignal.timeout(Math.max(5_000, deadline - Date.now() - 10_000)));
          report.tokens += tokens;
          report.checked += 1;
          if (!isInterviewRequest(analysis)) {
            await saveMessage(memberId, email, analysis.category, analysis, null);
            continue;
          }
          report.requests += 1;
          const match = matchJob(jobs, {
            companyName: analysis.company_name,
            jobTitle: analysis.job_title,
            jobReference: analysis.job_reference,
            fromEmail: email.fromEmail,
          });
          // Saved first: when another check already saved this email, it also did the rest.
          if (!(await saveMessage(memberId, email, analysis.category, analysis, match?.job.id ?? null))) continue;
          const link = gmailLink(account.email, email.id);
          const from = email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail;
          if (match) {
            report.matched += 1;
            await markRequested(match.job, { at: email.receivedAt, link, subject: email.subject, from });
          } else {
            report.unmatched += 1;
          }
        } catch (error) {
          if (error instanceof GmailAccessError) {
            fatal = error;
            next = todo.length;
            return;
          }
          report.failed += 1;
          if (received !== null) oldestFailure = oldestFailure === null ? received : Math.min(oldestFailure, received);
          else oldestFailure = since.getTime(); // not even read: start this whole window again
          report.error = `Some emails could not be analyzed (tried again next time): ${error instanceof Error ? error.message : String(error)}`.slice(0, 500);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (fatal) throw fatal;

    report.left = Math.max(0, todo.length - next);
    if (report.left) {
      report.status = "partial";
    } else {
      fullPass = true;
      cursor = oldestFailure === null ? runStart : new Date(Math.min(runStart.getTime(), oldestFailure - 1000));
    }
  } catch (error) {
    report.status = error instanceof SkipError ? "skipped" : "error";
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    await query(
      `UPDATE gmail_accounts SET sync_started_at = NULL, last_result = $2,
         last_error = $3,
         synced_through = COALESCE($4, synced_through),
         last_sync_at = CASE WHEN $5 THEN now() ELSE last_sync_at END
       WHERE member_id = $1`,
      [memberId, JSON.stringify(report), report.status === "error" || report.status === "skipped" ? report.error ?? "" : "", cursor, fullPass],
    );
  }
  return report;
}

class SkipError extends Error {}

/** Records an analyzed email. False when it was already recorded (by a check running at the same time). */
async function saveMessage(
  memberId: number,
  email: { id: string; receivedAt: Date; fromName: string; fromEmail: string; subject: string },
  category: string,
  analysis: EmailAnalysis | null,
  jobId: number | null,
) {
  const rows = await query(
    `INSERT INTO gmail_messages (member_id, message_id, received_at, sender, subject, category, interview_request, company_name, job_title, job_id, analysis)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (member_id, message_id) DO NOTHING RETURNING message_id`,
    [
      memberId,
      email.id,
      email.receivedAt,
      (email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail).slice(0, 300),
      email.subject.slice(0, 500),
      category,
      Boolean(analysis && isInterviewRequest(analysis)),
      analysis?.company_name ?? "",
      analysis?.job_title ?? "",
      jobId,
      JSON.stringify(analysis ?? {}),
    ],
  );
  return rows.length > 0;
}

/** Marks the job "Request Schedule" with the newest request email (an older email never replaces a newer one). */
async function markRequested(job: CandidateJob, email: { at: Date; link: string; subject: string; from: string }) {
  await query(
    `UPDATE jobs SET interview_requested = TRUE, interview_request_at = $2, interview_request_url = $3,
       interview_request_subject = $4, interview_request_from = $5, updated_at = now()
     WHERE id = $1 AND (interview_request_at IS NULL OR interview_request_at <= $2)`,
    [job.id, email.at, email.link, email.subject.slice(0, 500), email.from.slice(0, 300)],
  );
}
