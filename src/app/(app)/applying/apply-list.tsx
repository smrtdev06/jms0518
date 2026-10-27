"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ChevronDown, ImagePlus, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import type { JobRow } from "@/lib/jobs";
import { StatusBadge } from "@/components/status-badge";
import { DocButton, EmptyState, JobHeading, JobThumb, isBlankClick, timeAgo } from "@/components/job-parts";

// Common reasons offered as one-click choices when applying fails; the text stays editable.
const FAIL_REASONS = [
  "Job is closed / no longer available",
  "Location or visa requirement not met",
  "Application form error",
  "Requires an account, test or assessment",
  "Already applied with this profile",
];

export function ApplyList({ jobs, showAssignee, emptyHint }: { jobs: JobRow[]; showAssignee?: boolean; emptyHint?: string }) {
  const [openId, setOpenId] = useState<number | null>(null);
  // Changes made here (applied, failed, try again) show right away and the row stays in place,
  // even under a filter it no longer matches, until the filter, page or search changes.
  const [rows, setRows] = useState(jobs);
  const [imageVersion, setImageVersion] = useState<Record<number, number>>({});
  useEffect(() => setRows(jobs), [jobs]);

  const patchRow = (id: number, patch: Partial<JobRow>) => {
    setRows((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
    setOpenId(null);
  };
  const now = () => new Date().toISOString();

  if (!rows.length) {
    return <EmptyState title="No jobs here" hint={emptyHint ?? "Jobs appear here as soon as the Resume Tailor finishes their resume and cover letter."} />;
  }

  return (
    <div className="card divide-y divide-line overflow-hidden">
      {rows.map((job) => {
        const openable = job.apply_status === "ready" || job.apply_status === "failed";
        const open = openId === job.id && openable;
        return (
          <div key={job.id} className={clsx(open && "bg-surface-2/60", job.apply_status === "failed" && !open && "bg-rose-500/[0.03]")}>
            <div
              className={clsx("flex flex-col gap-3 px-4 py-3 transition sm:flex-row sm:items-center", openable && "cursor-pointer hover:bg-surface-2/50")}
              onClick={(e) => {
                if (openable && isBlankClick(e)) setOpenId(open ? null : job.id);
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <JobThumb job={job} version={imageVersion[job.id]} />
                <div className="min-w-0 flex-1">
                  <JobHeading job={job} assignee={showAssignee ? "bidder" : undefined} />
                  {job.apply_status === "failed" && <FailNote job={job} />}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <div className="flex items-center gap-2">
                  {job.apply_status === "applied" && (
                    <span className="text-[11px] text-faint" suppressHydrationWarning>
                      {job.applied_by_name ? `${job.applied_by_name} · ` : ""}
                      {timeAgo(job.applied_at)}
                    </span>
                  )}
                  {openable && <ChevronDown className={clsx("size-4 text-faint transition", open && "rotate-180")} />}
                  <StatusBadge status={job.apply_status} />
                </div>
                <div className="flex gap-2">
                  <DocButton job={job} type="resume" />
                  <DocButton job={job} type="cover_letter" />
                </div>
              </div>
            </div>
            {open && job.apply_status === "ready" && (
              <DropZone
                jobId={job.id}
                onApplied={() => {
                  patchRow(job.id, { apply_status: "applied", applied_at: now(), applied_by_name: "You", has_image: true });
                  setImageVersion((versions) => ({ ...versions, [job.id]: Date.now() }));
                }}
                onFailed={(reason) =>
                  patchRow(job.id, { apply_status: "failed", apply_fail_reason: reason, apply_failed_at: now(), apply_failed_by_name: "You" })
                }
                onCancel={() => setOpenId(null)}
              />
            )}
            {open && job.apply_status === "failed" && (
              <RetryPanel
                job={job}
                onReady={() => patchRow(job.id, { apply_status: "ready", apply_fail_reason: "", apply_failed_at: null, apply_failed_by_name: null })}
                onCancel={() => setOpenId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FailNote({ job }: { job: JobRow }) {
  return (
    <div className="mt-2 flex max-w-2xl items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-300" />
      <div className="min-w-0">
        <span className="font-medium text-rose-200">Couldn&apos;t apply: </span>
        <span className="break-words text-rose-100/90">{job.apply_fail_reason}</span>
        <div className="mt-0.5 text-[11px] text-rose-200/60" suppressHydrationWarning>
          {job.apply_failed_by_name ? `${job.apply_failed_by_name} · ` : ""}
          {timeAgo(job.apply_failed_at)}
        </div>
      </div>
    </div>
  );
}

function DropZone({ jobId, onApplied, onFailed, onCancel }: { jobId: number; onApplied: () => void; onFailed: (reason: string) => void; onCancel: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [failing, setFailing] = useState(false);

  const choose = useCallback((candidate: File | null | undefined) => {
    if (!candidate) return;
    if (!candidate.type.startsWith("image/")) {
      setError("Please use an image (PNG, JPEG, WEBP or GIF).");
      return;
    }
    setError("");
    setFile(candidate);
  }, []);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = useCallback(async () => {
    if (!file || pending) return;
    setPending(true);
    setError("");
    const body = new FormData();
    body.append("image", file);
    const res = await fetch(`/api/jobs/${jobId}/applied-image`, { method: "POST", body }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error ?? "Upload failed. Please try again.");
      setPending(false);
      return;
    }
    onApplied();
  }, [file, jobId, onApplied, pending]);

  // While open: paste a screenshot from anywhere on the page, Enter submits, Escape closes.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        choose(item.getAsFile());
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select");
      if (e.key === "Enter" && !typing) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") onCancel();
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [choose, submit, onCancel]);

  return (
    <div className="border-t border-line/60 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === " " && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files?.[0]);
          }}
          className={clsx(
            "flex min-h-24 flex-1 cursor-pointer items-center justify-center gap-4 rounded-lg border-2 border-dashed px-4 py-3 text-center transition",
            dragging ? "border-accent bg-accent/10" : "border-line-strong bg-bg/40 hover:border-faint",
          )}
        >
          {preview ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Screenshot preview" className="max-h-28 rounded border border-line object-contain" />
              <div className="text-left text-xs">
                <p className="font-medium">{file?.name || "Pasted image"}</p>
                <p className="mt-0.5 text-muted">{((file?.size ?? 0) / 1024).toFixed(0)} KB · press Enter to submit</p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-xs text-muted">
              <ImagePlus className="size-5 text-faint" />
              <span>
                Drag and drop the applied screenshot, <span className="text-fg">paste it (Ctrl+V)</span>, or click to browse
              </span>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </div>
        <div className="flex shrink-0 flex-row items-center justify-end gap-2 sm:flex-col sm:justify-center">
          <button className="btn btn-primary w-28" disabled={!file || pending} onClick={submit}>
            {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Submit
          </button>
          <button className="btn btn-ghost w-28" onClick={file ? () => setFile(null) : onCancel} disabled={pending}>
            <X className="size-3.5" />
            {file ? "Clear" : "Close"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      {failing ? (
        <FailForm jobId={jobId} onFailed={onFailed} onCancel={() => setFailing(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setFailing(true)}
          className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-rose-300"
        >
          <AlertTriangle className="size-3.5" />
          Couldn&apos;t apply? Mark as failed
        </button>
      )}
    </div>
  );
}

function FailForm({ jobId, onFailed, onCancel }: { jobId: number; onFailed: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const text = reason.trim();

  async function save() {
    if (text.length < 3 || pending) return;
    setPending(true);
    setError("");
    const res = await fetch(`/api/jobs/${jobId}/apply-failed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: text }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error ?? "Could not save. Please try again.");
      setPending(false);
      return;
    }
    onFailed(text);
  }

  return (
    <div className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-rose-200">
        <AlertTriangle className="size-3.5" />
        Why couldn&apos;t you apply?
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {FAIL_REASONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setReason(option)}
            className={clsx(
              "rounded-full border px-2.5 py-1 text-[11px] transition",
              reason === option ? "border-rose-400/50 bg-rose-500/20 text-rose-100" : "border-line-strong text-muted hover:border-rose-400/40 hover:text-rose-200",
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
          if (e.key === "Escape") e.stopPropagation();
        }}
        placeholder="Write the reason (or pick one above)…"
        maxLength={1000}
        autoFocus
        className="input mt-2 h-auto resize-y py-2 text-xs"
      />
      {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={save} disabled={pending || text.length < 3}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
          Mark as failed
        </button>
      </div>
    </div>
  );
}

function RetryPanel({ job, onReady, onCancel }: { job: JobRow; onReady: () => void; onCancel: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setPending(true);
    setError("");
    const res = await fetch(`/api/jobs/${job.id}/apply-failed`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error ?? "Could not update. Please try again.");
      setPending(false);
      return;
    }
    onReady();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted">
        Applying failed. When the problem is solved, move this job back to <span className="text-fg">Ready to Apply</span> and apply again.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {error && <span className="text-xs text-rose-300">{error}</span>}
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
          <X className="size-3.5" /> Close
        </button>
        <button type="button" className="btn btn-secondary" onClick={retry} disabled={pending}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          Try again
        </button>
      </div>
    </div>
  );
}
