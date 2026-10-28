"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CalendarClock, ChevronDown, History, LoaderCircle, Lock, MessageSquareText, Pencil, Save, Trash2, X } from "lucide-react";
import type { InterviewRound, JobRow } from "@/lib/jobs";
import { TIMEZONES, formatInterviewRange, timezoneLabel } from "@/lib/timezones";
import { StatusBadge } from "@/components/status-badge";
import { DocButton, EmptyState, JobHeading, JobThumb, isBlankClick, timeAgo } from "@/components/job-parts";
import { interviewTiming, interviewWindow, useNow } from "./timing";

export function InterviewList({ jobs, canEdit }: { jobs: JobRow[]; canEdit: boolean }) {
  // Members (who can edit) also see which caller each interview is assigned to.
  const [openId, setOpenId] = useState<number | null>(null);

  if (!jobs.length) return <EmptyState title="No interviews in this view" hint={canEdit ? "Try another view, or schedule interviews for applied jobs." : "Try another view. Your member assigns scheduled interviews to you on the Team page."} />;

  return (
    <div className="card divide-y divide-line overflow-hidden">
      {jobs.map((job) => {
        const open = openId === job.id;
        return (
          <div key={job.id} className={clsx(open && "bg-surface-2/60")}>
            <div
              className="flex cursor-pointer flex-col gap-3 px-4 py-3 transition hover:bg-surface-2/50 sm:flex-row sm:items-center"
              onClick={(e) => isBlankClick(e) && setOpenId(open ? null : job.id)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <JobThumb job={job} />
                <JobHeading job={job} assignee={canEdit ? "caller" : undefined} />
              </div>
              <WhenLabel job={job} />
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <div className="flex items-center gap-2">
                  <ChevronDown className={clsx("size-4 text-faint transition", open && "rotate-180")} />
                  {job.interview_result_outcome && <ResultChip outcome={job.interview_result_outcome} />}
                  <InterviewStatus job={job} />
                </div>
                <DocButton job={job} type="resume" />
              </div>
            </div>
            {open && <Details job={job} canEdit={canEdit} />}
          </div>
        );
      })}
    </div>
  );
}

function WhenLabel({ job }: { job: JobRow }) {
  const now = useNow();
  if (!job.interview_date) return null;
  const slot = interviewWindow(job);
  // Offered / rejected interviews are decided, so their time no longer needs attention.
  const timing =
    slot && now && !["offered", "rejected"].includes(job.interview_status)
      ? interviewTiming(slot, now, job.interview_status !== "scheduled" && Boolean(job.interview_result_outcome))
      : null;
  const local = slot ? slot.start.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <div className="flex items-center gap-2 text-xs text-muted sm:max-w-96 sm:text-right" title={local ? `Your local time: ${local}` : undefined}>
      <CalendarClock className="size-3.5 shrink-0 text-faint" />
      <span>{formatInterviewRange(job.interview_date, job.interview_start, job.interview_end, job.interview_timezone)}</span>
      {timing && (
        <span className={clsx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium", timing.tone)}>
          {timing.pulse && (
            <span className="relative flex size-1.5">
              <span className={clsx("absolute inline-flex size-full animate-ping rounded-full opacity-75", timing.pulse)} />
              <span className={clsx("relative inline-flex size-1.5 rounded-full", timing.pulse)} />
            </span>
          )}
          {timing.text}
        </span>
      )}
    </div>
  );
}

function Details({ job, canEdit }: { job: JobRow; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const initial = {
    email: job.interview_email,
    note: job.interview_note,
    date: job.interview_date ?? "",
    start_time: job.interview_start ?? "",
    end_time: job.interview_end ?? "",
    timezone: job.interview_timezone || "America/New_York",
  };
  const [form, setForm] = useState(initial);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function call(method: "PUT" | "POST", body?: unknown) {
    setPending(true);
    setError("");
    const res = await fetch(`/api/jobs/${job.id}/interview`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setPending(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error ?? "Something went wrong");
      return false;
    }
    router.refresh();
    return true;
  }

  // Offered needs the interview result first (status "interviewed"); then Offered → Rejected.
  const advanceLabel = job.interview_status === "offered" || job.interview_status === "rejected" ? "Rejected" : "Offered";
  const advanceDisabled = pending || !["interviewed", "offered"].includes(job.interview_status);
  const advanceHint =
    job.interview_status === "unscheduled"
      ? "Schedule the interview first"
      : job.interview_status === "scheduled"
        ? "Add the interview result first"
        : undefined;
  async function advance() {
    const message =
      advanceLabel === "Offered" ? "Mark this interview as Offered?" : "Mark this interview as Rejected? This cannot be undone.";
    if (window.confirm(message)) await call("POST");
  }

  const tzOptions = (TIMEZONES as readonly string[]).map((tz) => ({ value: tz, label: `${tz.replace(/_/g, " ")} (${timezoneLabel(tz)})` }));

  return (
    <div className="border-t border-line/60 px-4 py-3" data-no-toggle>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="grid flex-1 grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Email" className="sm:col-span-2 lg:col-span-3">
            {editing ? (
              <input className="input h-8 text-xs" value={form.email} onChange={set("email")} placeholder="Link to the email thread" />
            ) : job.interview_email ? (
              /^https?:\/\//.test(job.interview_email) ? (
                <a href={job.interview_email} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">
                  {job.interview_email}
                </a>
              ) : (
                <span className="break-all">{job.interview_email}</span>
              )
            ) : (
              <Empty />
            )}
          </Field>
          <Field label="Note" className="sm:col-span-2 lg:col-span-3">
            {editing ? (
              <input className="input h-8 text-xs" value={form.note} onChange={set("note")} placeholder="e.g. Recruiter call" />
            ) : (
              job.interview_note || <Empty />
            )}
          </Field>
          <Field label="Date" className="lg:col-span-1">
            {editing ? <input type="date" className="input h-8 text-xs" value={form.date} onChange={set("date")} /> : job.interview_date || <Empty />}
          </Field>
          <Field label="Start time" className="lg:col-span-1">
            {editing ? (
              <input type="time" className="input h-8 text-xs" value={form.start_time} onChange={set("start_time")} />
            ) : (
              job.interview_start || <Empty />
            )}
          </Field>
          <Field label="End time" className="lg:col-span-1">
            {editing ? (
              <input type="time" className="input h-8 text-xs" value={form.end_time} onChange={set("end_time")} />
            ) : (
              job.interview_end || <Empty />
            )}
          </Field>
          <Field label="Timezone" className="sm:col-span-2 lg:col-span-3">
            {editing ? (
              <select className="input h-8 text-xs" value={form.timezone} onChange={set("timezone")}>
                {tzOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <span suppressHydrationWarning>
                {job.interview_timezone.replace(/_/g, " ")} ({timezoneLabel(job.interview_timezone, job.interview_start_at ? new Date(job.interview_start_at) : undefined)})
              </span>
            )}
          </Field>
        </div>

        {canEdit && (
          <div className="flex shrink-0 flex-row items-start gap-2 lg:w-28 lg:flex-col">
            <button
              className={clsx("btn w-28", advanceLabel === "Offered" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20" : "btn-danger")}
              disabled={advanceDisabled || editing}
              onClick={advance}
              title={advanceHint}
            >
              {advanceLabel}
            </button>
            {editing ? (
              <>
                <button
                  className="btn btn-primary w-28"
                  disabled={pending}
                  onClick={async () => (await call("PUT", form)) && setEditing(false)}
                >
                  {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save
                </button>
                <button
                  className="btn btn-ghost w-28"
                  disabled={pending}
                  onClick={() => {
                    setForm(initial);
                    setEditing(false);
                    setError("");
                  }}
                >
                  <X className="size-3.5" />
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="btn btn-secondary w-28"
                onClick={() => setEditing(true)}
                disabled={job.interview_status === "rejected"}
                title={job.interview_status === "rejected" ? "A rejected interview can no longer be edited" : undefined}
              >
                <Pencil className="size-3.5" />
                Edit
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {job.interview_status !== "unscheduled" && <ResultSection job={job} />}
      {job.interview_rounds.length > 0 && <PreviousRounds rounds={job.interview_rounds} />}
      <StepHistory job={job} />
    </div>
  );
}

const OUTCOMES = {
  positive: {
    label: "Went well",
    dot: "bg-emerald-400",
    card: "border-emerald-400/25 bg-emerald-400/[0.06]",
    stripe: "bg-emerald-400",
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  neutral: {
    label: "Neutral",
    dot: "bg-zinc-400",
    card: "border-line-strong bg-surface-2/60",
    stripe: "bg-zinc-400",
    chip: "border-zinc-400/25 bg-zinc-400/10 text-zinc-300",
  },
  negative: {
    label: "Went poorly",
    dot: "bg-rose-400",
    card: "border-rose-400/25 bg-rose-500/[0.06]",
    stripe: "bg-rose-400",
    chip: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  },
} as const;
type Outcome = keyof typeof OUTCOMES;

// Who did each step of this job and when (applying, scheduling, the result and the decision).
function StepHistory({ job }: { job: JobRow }) {
  const steps = [
    { label: "Applied", by: job.applied_by_name, at: job.applied_at, dot: "bg-zinc-400" },
    { label: "Scheduled", by: job.scheduled_by_name, at: job.scheduled_at, dot: "bg-violet-400" },
    { label: "Result", by: job.interview_result_by_name, at: job.interview_result_at, dot: "bg-sky-400" },
    { label: "Offered", by: job.offered_by_name, at: job.offered_at, dot: "bg-emerald-400" },
    { label: "Rejected", by: job.rejected_by_name, at: job.rejected_at, dot: "bg-rose-400" },
  ].filter((step) => step.at);
  if (!steps.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-2.5 text-[11px] text-faint">
      {steps.map((step) => (
        <span key={step.label} className="inline-flex items-center gap-1.5" suppressHydrationWarning>
          <span className={clsx("size-1.5 rounded-full", step.dot)} />
          <span className="text-muted">{step.label}</span>
          {step.by ? `by ${step.by}` : ""} · {timeAgo(step.at)}
        </span>
      ))}
    </div>
  );
}

// Shown on the collapsed row, so results are visible without opening it.
function ResultChip({ outcome }: { outcome: Outcome }) {
  const o = OUTCOMES[outcome];
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium", o.chip)} title="Interview result note">
      <MessageSquareText className="size-3" />
      {o.label}
    </span>
  );
}

// The result note left after the interview: by the caller who attended, or a member.
function ResultSection({ job }: { job: JobRow }) {
  const router = useRouter();
  const saved = job.interview_result_outcome;
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | "">(saved);
  const [note, setNote] = useState(job.interview_result_note);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // The result can be written once the interview has ended (interviews without a date are not restricted).
  const now = useNow();
  const slot = interviewWindow(job);
  const ended = !slot || (now !== null && now.getTime() >= slot.end.getTime());
  const endsAt = slot?.end.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  async function save(next: { outcome: Outcome | ""; note: string }) {
    setPending(true);
    setError("");
    const res = await fetch(`/api/jobs/${job.id}/interview-result`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);
    setPending(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error ?? "Could not save the result");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const start = () => {
    setOutcome(saved);
    setNote(job.interview_result_note);
    setError("");
    setEditing(true);
  };

  return (
    <div className="mt-4 border-t border-line/60 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
          Interview result{job.interview_rounds.length ? ` · round ${job.interview_rounds.length + 1}` : ""}
        </span>
        {!editing && saved && ended && (
          <button type="button" className="btn btn-ghost h-7 px-2" onClick={start}>
            <Pencil className="size-3.5" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2.5 rounded-lg border border-line-strong bg-surface-2/60 p-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How did the interview go?">
            {(Object.keys(OUTCOMES) as Outcome[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={outcome === key}
                onClick={() => setOutcome(key)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
                  outcome === key ? OUTCOMES[key].chip : "border-line-strong text-muted hover:text-fg",
                )}
              >
                <span className={clsx("size-2 rounded-full", OUTCOMES[key].dot)} />
                {OUTCOMES[key].label}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            autoFocus
            value={note}
            maxLength={4000}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && outcome) save({ outcome, note });
            }}
            placeholder="What happened? Who you met, questions asked, next steps…"
            className="input h-auto resize-y py-2 text-xs leading-relaxed"
          />
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <div className="flex items-center gap-2">
            {saved && (
              <button
                type="button"
                className="btn btn-ghost px-2 hover:text-rose-300"
                disabled={pending}
                onClick={() => window.confirm("Remove this interview result?") && save({ outcome: "", note: "" })}
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            )}
            <span className="ml-auto text-[11px] text-faint">Ctrl+Enter to save</span>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={pending || !outcome} onClick={() => outcome && save({ outcome, note })}>
              {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save result
            </button>
          </div>
        </div>
      ) : saved ? (
        <div className={clsx("relative overflow-hidden rounded-lg border py-2.5 pl-4 pr-3", OUTCOMES[saved].card)}>
          <span className={clsx("absolute inset-y-0 left-0 w-1", OUTCOMES[saved].stripe)} />
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className={clsx("size-2 rounded-full", OUTCOMES[saved].dot)} />
            {OUTCOMES[saved].label}
            <span className="font-normal text-faint" suppressHydrationWarning>
              · {job.interview_result_by_name ?? "Someone"} · {timeAgo(job.interview_result_at)}
            </span>
          </div>
          {job.interview_result_note && (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg/90">{job.interview_result_note}</p>
          )}
        </div>
      ) : ended ? (
        <button
          type="button"
          onClick={start}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-xs text-muted transition hover:border-faint hover:text-fg"
        >
          <MessageSquareText className="size-4" />
          Add the interview result — how did it go?
        </button>
      ) : (
        <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-xs text-faint">
          <Lock className="size-3.5" />
          The result can be added after the interview ends{endsAt ? ` (${endsAt})` : ""}.
        </div>
      )}
    </div>
  );
}

// The results of earlier rounds, kept when the interview was rescheduled for the next round (newest first).
function PreviousRounds({ rounds }: { rounds: InterviewRound[] }) {
  return (
    <div className="mt-4 border-t border-line/60 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        <History className="size-3.5" /> Previous rounds
      </div>
      <ol className="space-y-2">
        {[...rounds].reverse().map((r) => {
          const o = r.outcome ? OUTCOMES[r.outcome] : null;
          return (
            <li key={r.round} className="flex gap-3 rounded-lg border border-line bg-surface-2/40 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded bg-surface-3 px-1.5 text-[10px] font-medium tabular-nums text-muted">Round {r.round}</span>
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {o && (
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span className={clsx("size-2 rounded-full", o.dot)} />
                      {o.label}
                    </span>
                  )}
                  <span className="text-faint" suppressHydrationWarning>
                    {r.date ? formatInterviewRange(r.date, r.start, r.end, r.timezone) : "earlier round"}
                    {r.result_at ? ` · result by ${r.result_by_name ?? "someone"} · ${timeAgo(r.result_at)}` : ""}
                  </span>
                </div>
                {r.note && <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-fg/80">{r.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <div className="min-h-5 text-fg">{children}</div>
    </div>
  );
}

const Empty = () => <span className="text-faint">—</span>;

// Scheduled becomes "Needs Result" as soon as the interview has ended (the caller has not added the result yet);
// re-checked every 30 seconds, so the badge changes without a reload.
function InterviewStatus({ job }: { job: JobRow }) {
  const now = useNow();
  const slot = interviewWindow(job);
  const ended = job.interview_status === "scheduled" && slot && now && now >= slot.end;
  return <StatusBadge status={ended ? "needs_result" : job.interview_status} />;
}
