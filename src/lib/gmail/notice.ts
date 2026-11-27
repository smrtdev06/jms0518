import { query, queryOne } from "../db";
import type { SessionUser } from "../auth";
import { mergeDay, type CheckRun, type NoticeAccount } from "./notice-data";

// The daily "Gmail check" notice (bottom right of every page). After a day's check, it is shown in the first session
// of each user that visits the site (the sign-in it was first shown in) and stays until the user closes it; a later
// sign-in that day does not show it again. Administrators and bosses see every profile Gmail; members, bidders and
// callers only their own profile's Gmail.

export type NoticeRequest = {
  profile: string;
  received_at: string | null;
  subject: string;
  sender: string;
  company_name: string;
  job_title: string;
  job_company: string | null;
  job_job_title: string | null;
};

export type GmailNotice = {
  day: string;
  finishedAt: string;
  scope: "all" | "own";
  accounts: NoticeAccount[];
  totals: { inboxes: number; checked: number; requests: number; matched: number; unmatched: number; problems: number };
  requests: NoticeRequest[];
  /** where the requests can be worked on, for this user */
  link: string | null;
};

/** The profiles (members' ids) whose Gmail the user may see: null = all. */
async function scopeOf(user: SessionUser): Promise<number[] | null> {
  if (user.role === "admin" || user.role === "boss") return null;
  if (user.role === "member") return [user.id];
  const row = await queryOne<{ member_id: number | null }>("SELECT member_id FROM users WHERE id = $1", [user.id]);
  return row?.member_id ? [row.member_id] : [];
}

/** The notice to show this user now, or null. Showing it the first time records it for this session. */
export async function noticeFor(user: SessionUser): Promise<GmailNotice | null> {
  const scope = await scopeOf(user);
  if (scope && !scope.length) return null;
  const runs = await query<CheckRun>("SELECT finished_at, reports FROM gmail_check_runs WHERE finished_at > now() - interval '8 days' ORDER BY finished_at");
  const merged = mergeDay(runs, scope);
  if (!merged) return null;

  // First visit after this day's check: this session gets the notice. Later: only the same session, until closed.
  await query("INSERT INTO gmail_notices (user_id, day, session) VALUES ($1, $2, $3) ON CONFLICT (user_id, day) DO NOTHING", [user.id, merged.day, user.session]);
  const seen = await queryOne<{ session: string; closed_at: Date | null }>("SELECT session, closed_at FROM gmail_notices WHERE user_id = $1 AND day = $2", [
    user.id,
    merged.day,
  ]);
  if (!seen || seen.closed_at || seen.session !== user.session) return null;

  const ids = merged.accounts.map((a) => a.memberId);
  const [profiles, requests] = await Promise.all([
    query<{ id: number; name: string }>("SELECT id, COALESCE(NULLIF(full_name, ''), NULLIF(display_name, ''), username) AS name FROM users WHERE id = ANY($1::int[])", [ids]),
    query<NoticeRequest>(
      `SELECT COALESCE(NULLIF(u.full_name, ''), u.username) AS profile, m.received_at, m.subject, m.sender, m.company_name, m.job_title,
         j.company_name AS job_company, j.job_title AS job_job_title
       FROM gmail_messages m JOIN users u ON u.id = m.member_id LEFT JOIN jobs j ON j.id = m.job_id
       WHERE m.interview_request AND m.member_id = ANY($1::int[]) AND (m.processed_at AT TIME ZONE 'UTC')::date = $2::date
       ORDER BY m.received_at DESC NULLS LAST LIMIT 30`,
      [ids, merged.day],
    ),
  ]);
  const name = new Map(profiles.map((p) => [p.id, p.name]));
  return {
    ...merged,
    scope: scope === null ? "all" : "own",
    accounts: merged.accounts.map((a) => ({ ...a, profile: name.get(a.memberId) ?? `Profile ${a.memberId}` })),
    requests: JSON.parse(JSON.stringify(requests)),
    link: user.role === "member" || user.role === "caller" ? "/interviews?status=requested" : null,
  };
}

export async function closeNotice(userId: number, day: string) {
  await query("UPDATE gmail_notices SET closed_at = now() WHERE user_id = $1 AND day = $2::date AND closed_at IS NULL", [userId, day]);
}
