"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, Mail, RefreshCw, Unplug } from "lucide-react";
import { FormError, Pill, Table, Td, Th } from "@/components/admin-ui";
import { formatDateTime } from "@/lib/format";
import { gmailConnection, gmailLink, sameMailbox } from "@/lib/gmail/mailbox";

type Report = { status?: string; checked?: number; requests?: number; matched?: number; unmatched?: number; left?: number; failed?: number; error?: string };

export type GmailMember = {
  id: number;
  username: string;
  display_name: string;
  full_name: string | null;
  profile_email: string;
  is_active: boolean;
  connected_email: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_result: Report | null;
  sync_started_at: string | null;
  requests: number;
  analyzed: number;
};

export type RequestEmail = {
  member_id: number;
  message_id: string;
  received_at: string | null;
  sender: string;
  subject: string;
  company_name: string;
  job_title: string;
  job_id: number | null;
  username: string;
  account_email: string | null;
  job_company: string | null;
  job_job_title: string | null;
};

type Config = { google: boolean; ai: boolean; cronSecret: boolean; vercel: boolean; redirectUri: string };

function state(m: GmailMember) {
  return gmailConnection(m.profile_email, m.connected_email, m.last_error);
}

export function GmailManager({ members, emails, config, notice }: { members: GmailMember[]; emails: RequestEmail[]; config: Config; notice: { connected: string; error: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [error, setError] = useState(notice.error);
  const [message, setMessage] = useState(() => {
    const m = members.find((x) => String(x.id) === notice.connected);
    return m ? `Connected ${m.connected_email} for ${m.username}. Its first check reads the emails of the last days; click Check now to run it.` : "";
  });
  const connected = members.filter((m) => m.connected_email);

  async function check(memberId: number | "all") {
    setBusy(memberId);
    setError("");
    setMessage("Checking… each new email is read by the AI, so this can take a few minutes.");
    const totals = { checked: 0, requests: 0, matched: 0, failed: 0 };
    let errors: string[] = [];
    // A check stops after about a minute; ask again until every inbox is done.
    for (let round = 0; round < 20; round += 1) {
      const res = await fetch("/api/admin/gmail/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(memberId === "all" ? {} : { memberId }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) {
        setError(data.error ?? "The check failed");
        break;
      }
      for (const a of data.accounts as (Report & { email: string })[]) {
        totals.checked += a.checked ?? 0;
        totals.requests += a.requests ?? 0;
        totals.matched += a.matched ?? 0;
        totals.failed += a.failed ?? 0;
      }
      errors = (data.accounts as (Report & { email: string })[]).filter((a) => a.error && a.status !== "partial").map((a) => `${a.email}: ${a.error}`);
      setMessage(`Checking… ${totals.checked} emails analyzed so far, ${totals.requests} interview requests.`);
      router.refresh();
      if (data.done) break;
    }
    setBusy(null);
    setMessage(
      `Check finished: ${totals.checked} new emails analyzed, ${totals.requests} interview requests, ${totals.matched} matched to a job.` +
        (totals.failed ? ` ${totals.failed} emails could not be analyzed; they are tried again next time.` : ""),
    );
    if (errors.length) setError(errors.join("\n"));
    router.refresh();
  }

  async function disconnect(m: GmailMember) {
    if (!window.confirm(`Disconnect ${m.connected_email} from ${m.username}? Interview requests already found stay on the jobs.`)) return;
    const res = await fetch(`/api/admin/gmail/${m.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError((await res?.json().catch(() => ({})))?.error ?? "Could not disconnect");
    else setMessage(`Disconnected ${m.connected_email}.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Each member&apos;s profile Gmail is checked once every 24 hours. The AI reads every new email, keeps only the ones asking to schedule an
        interview, finds the job each is about, and marks it <span className="text-amber-200">Request Schedule</span> in Interview Schedule (the member is
        notified). Connect each profile&apos;s Gmail here: sign in to that Gmail account on Google&apos;s page and allow reading email.
      </p>

      <Setup config={config} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          {connected.length} of {members.length} profile Gmails connected
        </span>
        <button className="btn btn-primary ml-auto" disabled={busy !== null || !connected.length || !config.google} onClick={() => check("all")}>
          {busy === "all" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check all now
        </button>
      </div>
      {message && <p className="whitespace-pre-line rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">{message}</p>}
      <FormError error={error} />

      <Table minWidth={980}>
        <thead>
          <tr>
            <Th>Member</Th>
            <Th>Profile Gmail</Th>
            <Th>Status</Th>
            <Th>Last check</Th>
            <Th>Requests found</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const s = state(m);
            const r = m.last_result ?? {};
            return (
              <tr key={m.id} className={clsx("hover:bg-surface-2/40", !m.is_active && "opacity-60")}>
                <Td>
                  <div className="font-medium">{m.username}</div>
                  <div className="text-xs text-muted">{m.full_name || m.display_name || "No profile yet"}</div>
                </Td>
                <Td>
                  {m.profile_email ? <span className="text-xs">{m.profile_email}</span> : <span className="text-xs text-faint">No email in the profile</span>}
                  {m.connected_email && !sameMailbox(m.connected_email, m.profile_email) && <div className="text-[11px] text-rose-300">connected: {m.connected_email}</div>}
                </Td>
                <Td>
                  <span title={s.hint}>
                    <Pill tone={s.tone}>{s.label}</Pill>
                  </span>
                  {m.sync_started_at && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted">
                      <LoaderCircle className="size-3 animate-spin" /> checking
                    </span>
                  )}
                  {s.hint && <div className="mt-1 max-w-72 text-[11px] text-rose-300/90">{s.hint}</div>}
                </Td>
                <Td className="text-xs text-muted">
                  {m.connected_email ? (
                    <>
                      <div>{m.last_sync_at ? formatDateTime(m.last_sync_at) : "Not yet"}</div>
                      {r.status && (
                        <div className="text-[11px] text-faint">
                          {r.checked ?? 0} analyzed · {r.requests ?? 0} requests
                          {r.left ? ` · ${r.left} left for the next check` : ""}
                          {r.failed ? ` · ${r.failed} failed` : ""}
                        </div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="text-xs">
                  {m.requests} {m.requests === 1 ? "job" : "jobs"}
                  <div className="text-[11px] text-faint">{m.analyzed.toLocaleString()} emails analyzed</div>
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {m.connected_email && (
                      <>
                        <button className="btn btn-secondary h-8 text-xs" disabled={busy !== null || !config.google} onClick={() => check(m.id)}>
                          {busy === m.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check now
                        </button>
                        <button className="btn btn-ghost h-8 px-2 hover:text-rose-300" title="Disconnect" onClick={() => disconnect(m)}>
                          <Unplug className="size-3.5" />
                        </button>
                      </>
                    )}
                    {config.google && m.profile_email ? (
                      <a className={clsx("btn h-8 text-xs", m.connected_email && s.tone !== "bad" ? "btn-ghost" : "btn-primary")} href={`/api/admin/gmail/connect?member=${m.id}`}>
                        <Mail className="size-3.5" /> {m.connected_email ? "Reconnect" : "Connect"}
                      </a>
                    ) : (
                      <button className="btn btn-ghost h-8 text-xs" disabled title={config.google ? "Add an email to the profile first" : "Set the Google client first"}>
                        <Mail className="size-3.5" /> Connect
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!members.length && (
            <tr>
              <Td colSpan={6} className="py-8 text-center text-sm text-muted">
                No members yet.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>

      <h2 className="pt-2 text-sm font-semibold">Recent interview request emails</h2>
      <Table minWidth={980}>
        <thead>
          <tr>
            <Th>Received</Th>
            <Th>Member</Th>
            <Th>Email</Th>
            <Th>Company / job (AI)</Th>
            <Th>Matched job</Th>
          </tr>
        </thead>
        <tbody>
          {emails.map((e) => (
            <tr key={`${e.member_id}-${e.message_id}`} className="hover:bg-surface-2/40">
              <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(e.received_at)}</Td>
              <Td className="text-xs">{e.username}</Td>
              <Td className="max-w-96">
                <a
                  className="inline-flex max-w-full items-center gap-1 text-xs hover:text-accent"
                  href={e.account_email ? gmailLink(e.account_email, e.message_id) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="truncate">{e.subject || "(no subject)"}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
                <div className="truncate text-[11px] text-faint">{e.sender}</div>
              </Td>
              <Td className="text-xs">
                {e.company_name || "—"}
                {e.job_title && <div className="text-[11px] text-muted">{e.job_title}</div>}
              </Td>
              <Td className="text-xs">
                {e.job_id ? (
                  <>
                    {e.job_company} <span className="text-faint">–</span> {e.job_job_title}
                  </>
                ) : (
                  <span className="text-amber-200/80">No matching job</span>
                )}
              </Td>
            </tr>
          ))}
          {!emails.length && (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-sm text-muted">
                No interview request emails found yet.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}

function Setup({ config }: { config: Config }) {
  const items = [
    { ok: config.google, text: "Google client: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set" },
    { ok: config.ai, text: "AI key for the email analysis (LLM_PROVIDER's API key) is set" },
    config.vercel
      ? { ok: config.cronSecret, text: "CRON_SECRET is set, so Vercel Cron can start the daily check (/api/cron/sync)" }
      : { ok: true, text: "This server runs the daily check itself while it is running (Vercel uses Vercel Cron)" },
  ];
  return (
    <div className="card space-y-1.5 px-4 py-3 text-xs">
      {items.map((item) => (
        <div key={item.text} className="flex items-center gap-2">
          {item.ok ? <CheckCircle2 className="size-3.5 text-emerald-300" /> : <AlertTriangle className="size-3.5 text-amber-300" />}
          <span className={item.ok ? "text-muted" : "text-amber-200"}>{item.text}</span>
        </div>
      ))}
      <div className="pt-1 text-muted">
        Authorized redirect URI for this site (Google Cloud console → Clients): <span className="select-all font-mono text-fg">{config.redirectUri}</span>
      </div>
    </div>
  );
}
