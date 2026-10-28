"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Database, Download, Eraser, ExternalLink, FileArchive, FileText, LoaderCircle, Mail, Pencil, Sparkles, X } from "lucide-react";
import type { JobRecord, JobStep, PublicProfile } from "@/lib/tailor/types";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/page-title";
import { Modal } from "@/components/admin-ui";

const STEPS: { key: JobStep; label: string }[] = [
  { key: "scrape", label: "Scrape" },
  { key: "fetch", label: "Fetch" },
  { key: "extract", label: "Extract" },
  { key: "generate", label: "Generate" },
  { key: "validate", label: "Validate" },
  { key: "zip", label: "Save" },
];

type DownloadKind = "resume" | "cover" | "zip";
const DOWNLOADS: { kind: DownloadKind; icon: typeof FileText; label: string }[] = [
  { kind: "resume", icon: FileText, label: "Resume" },
  { kind: "cover", icon: Mail, label: "Cover letter" },
  { kind: "zip", icon: FileArchive, label: "ZIP" },
];

// Reads a JSON answer; a non-JSON answer (a server error page) becomes { ok: false, error }.
async function readResponse(response: Response): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  try {
    const data = await response.json();
    if (data && typeof data === "object") return { ok: response.ok, ...data };
  } catch {
    /* not JSON */
  }
  return { ok: false, error: `The server answered with an error (HTTP ${response.status}). Try again.` };
}

export function TailorApp({ profile, initialJobs, keyReady, keyName }: { profile: PublicProfile; initialJobs: JobRecord[]; keyReady: boolean; keyName: string }) {
  const [urls, setUrls] = useState("");
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [fetchingLinks, setFetchingLinks] = useState(false);
  const [dbNote, setDbNote] = useState("");
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [connection, setConnection] = useState("");
  // Bumped by Generate and Clear, so a progress answer that was already on its way is ignored.
  const view = useRef(0);
  const links = useMemo(() => urls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), [urls]);
  const busy = jobs.some((job) => job.status === "queued" || job.status === "running");
  const done = jobs.filter((job) => job.status === "done");
  const failedCount = jobs.filter((job) => job.status === "failed" || job.status === "needs_manual").length;
  const generatingCount = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const leave = useLeaveGuard(failedCount, generatingCount);
  const [finished, setFinished] = useState<BatchSummary | null>(null);
  const wasBusy = useRef(busy);

  // When the batch finishes (nothing left queued or running): the message card, a desktop notification
  // when the page is in the background, and a tab title until the member comes back.
  useEffect(() => {
    if (wasBusy.current && !busy && jobs.length) announceDone(summarize(jobs), setFinished);
    wasBusy.current = busy;
  }, [busy, jobs]);

  // Checks progress while jobs run. Each check waits for the previous answer; errors back off.
  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1200;
    const poll = async () => {
      const asked = view.current;
      try {
        const response = await fetch("/api/tailor/jobs", { cache: "no-store" });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const data = await readResponse(response);
        if (cancelled || asked !== view.current) return;
        if (!data.ok) throw new Error(data.error);
        setJobs(data.jobs as JobRecord[]);
        setConnection("");
        delay = 1200;
      } catch {
        if (cancelled) return;
        setConnection("Lost contact with the server. Retrying…");
        delay = Math.min(delay * 2, 15000);
      }
      if (!cancelled) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [busy]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setDbNote("");
    setStarting(true);
    setFinished(null);
    // Ask once, while the member is here, so the "done" notification can reach them in another tab.
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
    try {
      view.current += 1;
      const data = await readResponse(
        await fetch("/api/tailor/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }) }),
      );
      if (!data.ok) setError(data.error || "Could not start.");
      else {
        const started = data.jobs as JobRecord[];
        setJobs(started);
        setUrls("");
        // Every link was skipped up front (all duplicates): the batch is already done.
        if (started.length && !started.some((job) => job.status === "queued" || job.status === "running")) announceDone(summarize(started), setFinished);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setStarting(false);
    }
  }

  // "Get from DB": the links the bot saved (job_links), one per line, added to what is already in the box.
  async function getFromDb() {
    setError("");
    setDbNote("");
    setFetchingLinks(true);
    try {
      const data = await readResponse(await fetch("/api/tailor/job-links", { cache: "no-store" }));
      if (!data.ok) {
        setError(data.error || "Could not read the job links.");
        return;
      }
      const stored = data.links as string[];
      const current = urls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const inBox = new Set(current);
      const added = stored.filter((link) => !inBox.has(link));
      if (added.length) setUrls([...current, ...added].join("\n"));
      const registered = Number(data.skipped) || 0;
      setDbNote(
        added.length
          ? `Added ${added.length} ${added.length === 1 ? "link" : "links"} from the database${registered ? ` (${registered} already registered left out)` : ""}.`
          : stored.length
            ? "Every link from the database is already in the box."
            : registered
              ? `No new links in the database — all ${registered} are already registered.`
              : "No job links in the database yet.",
      );
    } catch {
      setError("Could not reach the server.");
    } finally {
      setFetchingLinks(false);
    }
  }

  async function clear() {
    setError("");
    setFinished(null);
    setClearing(true);
    try {
      view.current += 1;
      const data = await readResponse(await fetch("/api/tailor/jobs", { method: "DELETE" }));
      if (!data.ok) setError(data.error || "Could not clear the board.");
      else setJobs([]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setClearing(false);
    }
  }

  async function downloadAll() {
    setError("");
    setDownloadingAll(true);
    try {
      const response = await fetch("/api/tailor/downloads/all");
      if (!response.ok) throw new Error((await readResponse(response)).error || "Could not download the packages.");
      saveFile(await response.blob(), "All-Packages.zip");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the packages.");
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <div className="space-y-5">
      {leave.dialog}
      {finished && <DoneToast summary={finished} onDownloadAll={downloadAll} onClose={() => setFinished(null)} />}
      <PageTitle
        title="Resume Tailor"
        subtitle="Paste job links to write a tailored resume and cover letter for each. Finished jobs go straight to Applying Management."
      />

      <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{profile.fullName}</div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {profile.headline}
            {profile.address ? ` · ${profile.address}` : ""}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-faint">
            {profile.email && <span>{profile.email}</span>}
            {profile.phone && <span>{profile.phone}</span>}
            {profile.linkedin && (
              <a href={profile.linkedin} target="_blank" rel="noreferrer" className="hover:text-accent">
                LinkedIn
              </a>
            )}
          </div>
        </div>
        <Link href="/tailor/profile" className="btn btn-secondary shrink-0">
          <Pencil className="size-3.5" /> Edit profile
        </Link>
      </section>

      <div className="space-y-5">
        <form onSubmit={generate} className="card flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div>
                <h2 className="text-sm font-semibold">Job URLs</h2>
                <p className="mt-0.5 text-xs text-muted">One link per line. Already registered links are skipped.</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary h-8 px-3 text-xs"
                onClick={getFromDb}
                disabled={fetchingLinks || starting || busy}
                title={busy ? "Wait until the current batch is finished" : "Put the job links the bot saved in the database into this box"}
              >
                {fetchingLinks ? <LoaderCircle className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
                Get from DB
              </button>
            </div>
            <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted" aria-live="polite">
              {links.length} {links.length === 1 ? "link" : "links"}
            </span>
          </div>
          <textarea
            aria-label="Job URLs, one per line"
            rows={7}
            spellCheck={false}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={"https://job-boards.greenhouse.io/…/jobs/123\nhttps://jobs.lever.co/…"}
            className="input h-auto min-h-36 resize-y py-2 font-mono text-xs leading-relaxed"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit();
            }}
          />
          {!keyReady && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">Set {keyName} in .env before generating.</p>
          )}
          {dbNote && <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted" aria-live="polite">{dbNote}</p>}
          {connection && <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">{connection}</p>}
          {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary h-9 px-5 text-sm" disabled={starting || busy || !links.length || !keyReady}>
              {starting ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate packages
            </button>
            <button type="button" className="btn btn-ghost h-9" onClick={clear} disabled={clearing || !jobs.length} title="Empty the board: failed jobs are deleted, finished jobs stay in Applying Management">
              {clearing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
              Clear
            </button>
            <span className="ml-auto text-[11px] text-faint">Ctrl+Enter to generate.</span>
          </div>
        </form>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Progress</h2>
              <p className="mt-0.5 text-xs text-muted">{jobs.length ? progressHint(jobs) : "Results appear here after you generate."}</p>
            </div>
            {done.length > 0 && (
              <button type="button" className="btn btn-secondary" onClick={downloadAll} disabled={downloadingAll} title="One ZIP with a folder for each finished package">
                {downloadingAll ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                Download all ZIPs ({done.length})
              </button>
            )}
          </div>
          {jobs.length ? (
            <ul className="space-y-3">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} onChange={setJobs} />
              ))}
            </ul>
          ) : (
            <div className="card px-6 py-12 text-center">
              <p className="text-sm font-medium">Add job URLs to start</p>
              <ol className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2 text-[11px] text-muted">
                {["Read the posting", "Skip duplicates", "Write resume + cover letter", "Check ATS match", "Save content", "Ready to Apply"].map((step, i) => (
                  <li key={step} className="rounded-full border border-line px-2.5 py-1">
                    {i + 1}. {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const BADGE: Record<JobRecord["status"], { label: string; className: string }> = {
  queued: { label: "Queued", className: "border-zinc-400/25 bg-zinc-400/10 text-zinc-300" },
  running: { label: "Running", className: "border-sky-400/35 bg-sky-400/15 text-sky-200" },
  needs_manual: { label: "Needs input", className: "border-amber-400/35 bg-amber-400/15 text-amber-200" },
  done: { label: "Ready to Apply", className: "border-indigo-400/30 bg-indigo-400/15 text-indigo-200" },
  failed: { label: "Failed", className: "border-rose-400/35 bg-rose-400/15 text-rose-200" },
  skipped: { label: "Skipped", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
};

function JobCard({ job, onChange }: { job: JobRecord; onChange: (jobs: JobRecord[]) => void }) {
  const [description, setDescription] = useState("");
  const [manualError, setManualError] = useState("");
  const [sending, setSending] = useState(false);
  // Downloads are tracked in page memory only, so a refresh enables everything again.
  const [downloaded, setDownloaded] = useState<DownloadKind[]>([]);
  const [downloading, setDownloading] = useState<DownloadKind | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const company = job.company || hostOf(job.url);
  const current = STEPS.findIndex((step) => step.key === job.step);
  const allDownloaded = job.status === "done" && DOWNLOADS.every((d) => downloaded.includes(d.kind));
  const badge = BADGE[job.status];

  async function download(kind: DownloadKind, filename: string) {
    setDownloading(kind);
    setDownloadError("");
    try {
      const response = await fetch(`/api/tailor/downloads/${job.id}/${kind}`);
      if (!response.ok) throw new Error((await readResponse(response)).error || "Could not download that file.");
      saveFile(await response.blob(), filename);
      setDownloaded((items) => (items.includes(kind) ? items : [...items, kind]));
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Could not download that file.");
    } finally {
      setDownloading(null);
    }
  }

  async function submitManual(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setManualError("");
    try {
      const data = await readResponse(
        await fetch(`/api/tailor/jobs/${job.id}/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }) }),
      );
      if (!data.ok) {
        setManualError(data.error || "Could not continue.");
        return;
      }
      const next = await readResponse(await fetch("/api/tailor/jobs", { cache: "no-store" }));
      if (next.ok) onChange(next.jobs as JobRecord[]);
    } catch {
      setManualError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <li id={`job-${job.id}`} className={clsx("card scroll-mt-20 p-4 transition", allDownloaded && "opacity-60", job.status === "skipped" && "border-amber-400/20")}>
      <div className="flex items-start gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-semibold text-muted">{job.position}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{company}</span>
            <span className={clsx("inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-[10px] font-medium", badge.className)}>{badge.label}</span>
            {job.atsScore !== null && (
              <span className={clsx("inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-[10px] font-medium", atsClass(job.atsScore))}>ATS {job.atsScore}/100</span>
            )}
          </div>
          {job.jobTitle && <p className="mt-0.5 text-xs text-fg/90">{job.jobTitle}</p>}
          <a href={job.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-muted hover:text-accent">
            <span className="truncate">{job.url}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        {job.usage && (
          <span className="hidden shrink-0 text-[11px] text-faint sm:block" title={usageTitle(job.usage)}>
            {job.usage.total.toLocaleString()} tokens
          </span>
        )}
      </div>

      {job.status !== "skipped" && (
        <ol className="mt-3 grid grid-cols-6 gap-1">
          {STEPS.map((step, index) => {
            const state = pipeState(job, index, current);
            return (
              <li key={step.key} className="flex flex-col items-center gap-1">
                <span
                  className={clsx(
                    "h-1 w-full rounded-full",
                    state === "done" && "bg-emerald-400/70",
                    state === "active" && "animate-pulse bg-sky-400",
                    state === "error" && "bg-rose-400",
                    state === "" && "bg-surface-3",
                  )}
                />
                <span className={clsx("text-[10px]", state === "active" ? "text-sky-200" : state === "error" ? "text-rose-300" : "text-faint")}>{step.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {job.message && <p className={clsx("mt-2 text-xs", job.status === "skipped" ? "text-amber-200" : "text-muted")}>{job.message}</p>}
      {job.error && job.status !== "done" && job.error !== job.message && <p className="mt-1 text-xs text-rose-300">{job.error}</p>}

      {job.status === "needs_manual" && (
        <form onSubmit={submitManual} className="mt-3 space-y-2">
          <label className="block text-xs text-muted">
            The page content could not be read. Paste the job description for this link.
            <textarea
              rows={7}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Paste the full job title, company, responsibilities and requirements…"
              className="input mt-1.5 h-auto py-2 text-xs"
            />
          </label>
          {manualError && <p className="text-xs text-rose-300" role="alert">{manualError}</p>}
          <button type="submit" className="btn btn-primary" disabled={sending || description.trim().length < 80}>
            {sending && <LoaderCircle className="size-3.5 animate-spin" />}
            Continue with this description
          </button>
        </form>
      )}

      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-faint hover:text-muted">
          <ChevronDown className="size-3 transition group-open:rotate-180" />
          Activity log ({job.logs.length})
        </summary>
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-bg/50 p-2.5 font-mono text-[11px] leading-relaxed">
          {job.logs.length ? (
            job.logs.map((entry, index) => (
              <p key={`${entry.at}-${index}`} className={entry.level === "error" ? "text-rose-300" : entry.level === "warn" ? "text-amber-200" : "text-muted"}>
                {entry.message}
              </p>
            ))
          ) : (
            <p className="text-faint">Waiting for activity.</p>
          )}
        </div>
      </details>

      {job.status === "done" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
          {DOWNLOADS.map(({ kind, icon: Icon, label }) => {
            const filename = kind === "resume" ? job.resumeName : kind === "cover" ? job.coverName : job.zipName;
            const isDone = downloaded.includes(kind);
            return (
              <button key={kind} type="button" className="btn btn-secondary" disabled={downloading !== null} onClick={() => download(kind, filename)} title={filename}>
                {downloading === kind ? <LoaderCircle className="size-3.5 animate-spin" /> : isDone ? <Check className="size-3.5 text-emerald-300" /> : <Icon className="size-3.5" />}
                {label}
              </button>
            );
          })}
          <Link href="/applying" className="ml-auto text-xs text-accent hover:underline">
            In Applying Management →
          </Link>
          {downloadError && <p className="w-full text-xs text-rose-300" role="alert">{downloadError}</p>}
        </div>
      )}
    </li>
  );
}

// Leaving the Resume Tailor (a link to another page or Sign out):
// - while a batch is still generating, the member can not leave. The dialog keeps them here; only "Leave anyway"
//   goes, and then the jobs still waiting or being generated are deleted.
// - otherwise, when the board has failed cards, it asks whether to remove them (Yes deletes, No keeps).
// Leaving by force (closing the tab, reloading, the browser's back button) while generating also deletes the
// unfinished jobs: the browser shows its own "Leave site?" prompt first, and the page tells the server on the way out.
function useLeaveGuard(failedCount: number, generatingCount: number) {
  const router = useRouter();
  const [pending, setPending] = useState<{ go: () => void } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const generating = generatingCount > 0;
  const generatingRef = useRef(generating);
  // Set when the member chose to leave (the server was already told), so the exit handlers do not repeat it.
  const abandoned = useRef(false);
  useEffect(() => {
    generatingRef.current = generating;
    if (generating) abandoned.current = false;
  }, [generating]);

  // Forced exits while generating.
  useEffect(() => {
    const abandon = () => {
      if (!generatingRef.current || abandoned.current) return;
      abandoned.current = true;
      navigator.sendBeacon("/api/tailor/jobs/abandon");
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!generatingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", abandon);
      // Unmounted by an in-app navigation the dialog did not catch (e.g. the back button). Checked after the
      // navigation, so a remount on the same page (React development mode) does not count as leaving.
      setTimeout(() => {
        if (window.location.pathname !== "/tailor") abandon();
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!failedCount && !generating) return;
    // Capture phase on the document runs before Next.js links handle the click.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      // While generating, even the Profile page counts as leaving (the batch must finish on this page).
      const staying = generating ? url.pathname === "/tailor" : url.pathname.startsWith("/tailor");
      if (url.origin !== window.location.origin || staying || url.pathname.startsWith("/api/")) return;
      event.preventDefault();
      event.stopPropagation();
      setError("");
      setPending({ go: () => router.push(url.pathname + url.search) });
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement;
      if (!form.action.endsWith("/api/auth/logout")) return;
      event.preventDefault();
      setError("");
      setPending({ go: () => form.submit() });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [failedCount, generating, router]);

  // Deletes cards on the server, then continues the navigation.
  async function removeAndLeave(url: string, failMessage: string, markAbandoned: boolean) {
    if (!pending) return;
    setRemoving(true);
    setError("");
    const response = await fetch(url, { method: url.endsWith("/abandon") ? "POST" : "DELETE" }).catch(() => null);
    setRemoving(false);
    if (!response?.ok) {
      setError(failMessage);
      return;
    }
    if (markAbandoned) {
      // Already told the server; the browser's own "Leave site?" prompt must not appear for Sign out either.
      abandoned.current = true;
      generatingRef.current = false;
    }
    pending.go();
    setPending(null);
  }

  const close = () => !removing && setPending(null);
  let dialog: React.ReactNode = null;
  if (pending && generating) {
    dialog = (
      <Modal title="Generation is still running" onClose={close}>
        <div className="flex gap-3">
          <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-accent" />
          <p className="text-sm text-muted">
            {generatingCount === 1 ? "1 job is" : `${generatingCount} jobs are`} still being generated. Please stay on this page until every
            job is finished — you will be notified when the batch is done.
          </p>
        </div>
        <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
          If you leave now, the unfinished {generatingCount === 1 ? "job is" : "jobs are"} discarded. Jobs that are already finished are kept.
        </p>
        {error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost text-rose-300 hover:text-rose-200"
            disabled={removing}
            onClick={() => removeAndLeave("/api/tailor/jobs/abandon", "Could not stop the generation. Try again.", true)}
          >
            {removing && <LoaderCircle className="size-3.5 animate-spin" />}
            Leave anyway and discard
          </button>
          <button type="button" className="btn btn-primary" onClick={close} disabled={removing} autoFocus>
            Stay on this page
          </button>
        </div>
      </Modal>
    );
  } else if (pending && failedCount) {
    dialog = (
      <Modal title="Remove failed jobs?" onClose={close}>
        <p className="text-sm text-muted">
          {failedCount === 1 ? "1 job on your board failed" : `${failedCount} jobs on your board failed`} (including any waiting for a pasted
          description). Do you want to remove {failedCount === 1 ? "it" : "them"} before leaving?
        </p>
        {error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setPending(null)} disabled={removing}>
            Stay on this page
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={removing}
            onClick={() => {
              pending.go();
              setPending(null);
            }}
          >
            No, keep them
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => removeAndLeave("/api/tailor/jobs?failed=1", "Could not remove the failed jobs. Try again.", false)}
            disabled={removing}
            autoFocus
          >
            {removing && <LoaderCircle className="size-3.5 animate-spin" />}
            Yes, remove them
          </button>
        </div>
      </Modal>
    );
  }

  // The batch finished without failures while the dialog was open: nothing to ask any more, the member may leave.
  useEffect(() => {
    if (pending && !generating && !failedCount) setPending(null);
  }, [pending, generating, failedCount]);

  return { dialog };
}

type BatchSummary = { total: number; ready: number; skipped: number; failed: number; firstFailedId: number | null; at: number };

function summarize(jobs: JobRecord[]): BatchSummary {
  const failed = jobs.filter((job) => job.status === "failed" || job.status === "needs_manual");
  return {
    total: jobs.length,
    ready: jobs.filter((job) => job.status === "done").length,
    skipped: jobs.filter((job) => job.status === "skipped").length,
    failed: failed.length,
    firstFailedId: failed[0]?.id ?? null,
    at: Date.now(),
  };
}

function headline(s: BatchSummary) {
  if (s.ready === s.total) return s.total === 1 ? "Your package is ready" : `All ${s.total} packages are ready`;
  if (!s.ready) return s.failed ? "The batch finished without a package" : "Every link was skipped";
  return `${s.ready} of ${s.total} packages are ready`;
}

function details(s: BatchSummary) {
  return [`${s.ready} ready`, s.skipped ? `${s.skipped} skipped` : "", s.failed ? `${s.failed} need${s.failed === 1 ? "s" : ""} attention` : ""].filter(Boolean).join(" · ");
}

// Shows the message card, and — when the page is in the background — a desktop notification and a tab title.
function announceDone(summary: BatchSummary, show: (s: BatchSummary) => void) {
  show(summary);
  if (typeof document === "undefined" || !document.hidden) return;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    const note = new Notification(`Resume Tailor · ${headline(summary)}`, { body: details(summary), tag: "resume-tailor-batch", icon: "/icon.svg" });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  }
  const original = document.title;
  document.title = `${summary.failed ? "⚠" : "✓"} ${summary.ready} ready · Resume Tailor`;
  const restore = () => {
    if (document.hidden) return;
    document.title = original;
    document.removeEventListener("visibilitychange", restore);
  };
  document.addEventListener("visibilitychange", restore);
}

function DoneToast({ summary, onDownloadAll, onClose }: { summary: BatchSummary; onDownloadAll: () => void; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [summary.at]);
  const allGood = summary.ready === summary.total;
  const Icon = allGood ? CheckCircle2 : AlertTriangle;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed bottom-5 right-5 z-40 w-[min(380px,calc(100vw-2.5rem))] overflow-hidden rounded-xl border bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur transition duration-300",
        allGood ? "border-emerald-400/30" : "border-amber-400/30",
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      <span className={clsx("absolute inset-x-0 top-0 h-0.5", allGood ? "bg-emerald-400" : "bg-amber-400")} />
      <div className="flex gap-3 p-4">
        <div className={clsx("flex size-9 shrink-0 items-center justify-center rounded-full", allGood ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300")}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">{headline(summary)}</p>
            <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded p-1 text-faint hover:bg-surface-3 hover:text-fg" aria-label="Close">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-muted">{details(summary)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.ready > 0 && (
              <Link href="/applying" className="btn btn-primary">
                Go to Applying Management
              </Link>
            )}
            {summary.ready > 0 && (
              <button type="button" className="btn btn-secondary" onClick={onDownloadAll}>
                <Download className="size-3.5" /> Download all
              </button>
            )}
            {summary.firstFailedId !== null && (
              <button
                type="button"
                className="btn btn-ghost text-amber-200"
                onClick={() => {
                  // Bring the first failed card into view and flash it so it is easy to spot.
                  const card = document.getElementById(`job-${summary.firstFailedId}`);
                  if (!card) return;
                  card.scrollIntoView({ behavior: "smooth", block: "start" });
                  card.classList.add("ring-2", "ring-amber-400/70");
                  setTimeout(() => card.classList.remove("ring-2", "ring-amber-400/70"), 1800);
                }}
              >
                Review failed
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function pipeState(job: JobRecord, index: number, current: number) {
  if (job.status === "done") return "done";
  if ((job.status === "failed" || job.status === "needs_manual") && index === current) return "error";
  if (current > index) return "done";
  if (current === index && (job.status === "running" || job.status === "queued")) return "active";
  return "";
}

function usageTitle(usage: JobRecord["usage"]) {
  if (!usage) return "";
  const cached = usage.cached ? `, ${usage.cached.toLocaleString()} of the prompt cached at a discount` : "";
  return `${usage.total.toLocaleString()} tokens (${usage.prompt.toLocaleString()} prompt, ${usage.completion.toLocaleString()} completion${cached})`;
}

function atsClass(score: number) {
  if (score >= 80) return "border-emerald-400/35 bg-emerald-400/15 text-emerald-200";
  if (score >= 60) return "border-amber-400/35 bg-amber-400/15 text-amber-200";
  return "border-rose-400/35 bg-rose-400/15 text-rose-200";
}

function progressHint(jobs: JobRecord[]) {
  const count = (...statuses: JobRecord["status"][]) => jobs.filter((job) => statuses.includes(job.status)).length;
  const parts = [`${count("done")} ready`, `${count("queued", "running")} running`, `${count("failed", "needs_manual")} need attention`];
  const skipped = count("skipped");
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(" · ");
}

function hostOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Job link";
  }
}
