import { headers } from "next/headers";
import { query } from "@/lib/db";
import { aiConfigured } from "@/lib/gmail/analyze";
import { googleConfigured, redirectUri } from "@/lib/gmail/google";
import { siteOrigin } from "@/lib/site-url";
import { GmailManager, type GmailMember, type RequestEmail } from "./gmail-manager";

export const metadata = { title: "Gmail · Administrator" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function GmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const origin = siteOrigin(await headers());

  const members = await query<GmailMember>(
    `SELECT u.id, u.username, u.display_name, u.full_name, u.email AS profile_email, u.is_active,
       g.email AS connected_email, g.connected_at, g.last_sync_at, g.last_error, g.last_result, g.sync_started_at,
       (SELECT count(*)::int FROM jobs j WHERE j.user_id = u.id AND j.interview_requested) AS requests,
       (SELECT count(*)::int FROM gmail_messages m WHERE m.member_id = u.id) AS analyzed
     FROM users u LEFT JOIN gmail_accounts g ON g.member_id = u.id
     WHERE u.role = 'member' ORDER BY u.is_active DESC, lower(u.username)`,
  );
  const emails = await query<RequestEmail>(
    `SELECT m.member_id, m.message_id, m.received_at, m.sender, m.subject, m.company_name, m.job_title, m.job_id,
       u.username, g.email AS account_email, j.company_name AS job_company, j.job_title AS job_job_title
     FROM gmail_messages m JOIN users u ON u.id = m.member_id
     LEFT JOIN gmail_accounts g ON g.member_id = m.member_id
     LEFT JOIN jobs j ON j.id = m.job_id
     WHERE m.interview_request ORDER BY m.received_at DESC NULLS LAST LIMIT 30`,
  );

  return (
    <GmailManager
      members={JSON.parse(JSON.stringify(members))}
      emails={JSON.parse(JSON.stringify(emails))}
      config={{
        google: googleConfigured(),
        ai: aiConfigured(),
        cronSecret: Boolean(process.env.CRON_SECRET?.trim()),
        vercel: Boolean(process.env.VERCEL),
        redirectUri: redirectUri(origin),
      }}
      notice={{ connected: first(sp.connected), error: first(sp.error).slice(0, 400) }}
    />
  );
}
