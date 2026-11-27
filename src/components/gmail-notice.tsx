"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, CalendarCheck2, CheckCircle2, Clock3, Inbox, MailCheck, Sparkles, X } from "lucide-react";
import type { GmailNotice } from "@/lib/gmail/notice";

/**
 * The daily "Gmail check" notice, bottom right. Shown after the day's check in the user's first session, on every page
 * until the user closes it (src/lib/gmail/notice.ts decides when).
 */
export function GmailCheckNotice() {
  const [notice, setNotice] = useState<GmailNotice | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/gmail/notice", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => alive && data?.notice && setNotice(data.notice))
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  if (!notice) return null;

  function close() {
    if (!notice) return;
    setLeaving(true);
    fetch("/api/gmail/notice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day: notice.day }) }).catch(() => null);
    setTimeout(() => setNotice(null), 220);
  }

  const { totals } = notice;
  const finished = new Date(notice.finishedAt);
  const when = `${finished.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${finished.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const headline = totals.requests
    ? `${totals.requests} interview ${totals.requests === 1 ? "request" : "requests"} found`
    : totals.problems === totals.inboxes
      ? "The Gmail check needs attention"
      : "No interview requests today";

  return (
    <aside
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed bottom-5 right-5 z-50 flex max-h-[calc(100vh-6rem)] w-[25rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface/95 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.75),0_0_0_1px_rgb(139_140_255/0.08)] backdrop-blur-xl",
        leaving ? "animate-notice-out" : "animate-notice-in",
      )}
    >
      <div className="h-1 shrink-0 bg-gradient-to-r from-accent via-sky-400 to-emerald-400" />

      {/* Header */}
      <div className="relative shrink-0 px-5 pb-4 pt-4">
        <div className="pointer-events-none absolute -right-10 -top-16 size-40 rounded-full bg-accent/15 blur-3xl" />
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-sky-400 text-white shadow-lg shadow-accent/25">
            <MailCheck className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-accent">Daily Gmail check</div>
            <h2 className="mt-0.5 text-[15px] font-semibold leading-snug text-fg">{headline}</h2>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <Clock3 className="size-3" />
              <span suppressHydrationWarning>{when}</span>
              <span className="text-faint">·</span>
              {totals.inboxes} {totals.inboxes === 1 ? "inbox" : "inboxes"}
              {notice.scope === "own" ? "" : " (all profiles)"}
            </p>
          </div>
          <button onClick={close} className="-mr-1.5 -mt-1 rounded-lg p-1.5 text-faint transition hover:bg-white/5 hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {/* Totals */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat icon={Inbox} label="Emails read" value={totals.checked} tone="text-sky-300" glow="from-sky-400/10" />
          <Stat icon={CalendarCheck2} label="Interview requests" value={totals.requests} tone="text-amber-300" glow="from-amber-400/10" />
          <Stat icon={Sparkles} label="Matched to jobs" value={totals.matched} tone="text-emerald-300" glow="from-emerald-400/10" />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-white/5 px-5 py-4">
        {/* Interview requests */}
        {notice.requests.length > 0 && (
          <section>
            <SectionTitle>New interview requests</SectionTitle>
            <ul className="space-y-1.5">
              {notice.requests.slice(0, 6).map((r, i) => {
                const company = r.job_company || r.company_name || r.sender;
                const title = r.job_job_title || r.job_title;
                return (
                  <li key={i} className="group flex gap-2.5 rounded-xl border border-amber-400/15 bg-gradient-to-r from-amber-400/[0.07] to-transparent px-3 py-2">
                    <span className="relative mt-1.5 flex size-2 shrink-0">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg">
                        {company}
                        {title && <span className="font-normal text-muted"> – {title}</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
                        {notice.scope === "all" && <span className="truncate text-muted">{r.profile}</span>}
                        {notice.scope === "all" && <span>·</span>}
                        {r.received_at && (
                          <span suppressHydrationWarning>{new Date(r.received_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        )}
                        {!r.job_company && <span className="rounded bg-white/5 px-1.5 py-px text-amber-200/80">no matching job</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
              {notice.requests.length > 6 && <li className="px-1 text-[11px] text-faint">and {notice.requests.length - 6} more</li>}
            </ul>
          </section>
        )}

        {/* Inboxes */}
        <section>
          <SectionTitle>{notice.scope === "own" ? "Your profile's Gmail" : "Profile Gmails"}</SectionTitle>
          <ul className="space-y-1">
            {notice.accounts.map((a) => (
              <li key={a.memberId} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-white/[0.03]">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-surface-3 to-surface-2 text-[11px] font-semibold text-muted ring-1 ring-white/10">
                  {initials(a.profile)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{a.profile}</div>
                  <div className="truncate text-[11px] text-faint">{a.email || "Gmail"}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <StatusChip status={a.status} />
                  <span className="text-[10px] text-faint">
                    {a.checked} read · {a.requests} {a.requests === 1 ? "request" : "requests"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {notice.accounts
            .filter((a) => a.error && (a.status === "error" || a.status === "skipped"))
            .map((a) => (
              <p key={a.memberId} className="mt-2 flex gap-2 rounded-xl border border-rose-400/20 bg-rose-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-rose-200/90">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                <span>
                  <span className="font-medium">{a.profile}:</span> {a.error}
                </span>
              </p>
            ))}
          {!totals.requests && totals.problems < totals.inboxes && (
            <p className="mt-2 text-[11px] text-faint">Every new email was read; none of them asked to schedule an interview.</p>
          )}
        </section>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/5 bg-black/10 px-5 py-3">
        <button onClick={close} className="btn btn-ghost h-8 text-xs">
          Close
        </button>
        {notice.link && totals.requests > 0 && (
          <Link href={notice.link} onClick={close} className="btn btn-primary h-8 text-xs">
            Open Interview Schedule <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
    </aside>
  );
}

function Stat({ icon: Icon, label, value, tone, glow }: { icon: typeof Inbox; label: string; value: number; tone: string; glow: string }) {
  return (
    <div className={clsx("rounded-xl border border-white/5 bg-gradient-to-b to-transparent px-3 py-2.5", glow)}>
      <Icon className={clsx("size-3.5", tone)} />
      <div className={clsx("mt-1.5 text-xl font-semibold tabular-nums leading-none", value ? tone : "text-faint")}>{value.toLocaleString()}</div>
      <div className="mt-1 text-[10px] leading-tight text-muted">{label}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{children}</h3>;
}

function StatusChip({ status }: { status: string }) {
  const style =
    status === "done"
      ? { icon: CheckCircle2, text: "Checked", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" }
      : status === "partial"
        ? { icon: Clock3, text: "Partly checked", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" }
        : { icon: AlertTriangle, text: status === "skipped" ? "Skipped" : "Error", className: "border-rose-400/30 bg-rose-400/10 text-rose-200" };
  const Icon = style.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", style.className)}>
      <Icon className="size-3" />
      {style.text}
    </span>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}
