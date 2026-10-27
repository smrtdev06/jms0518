"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ExternalLink, FileText, ImageOff, Mail, UserRound, X } from "lucide-react";
import type { JobRow } from "@/lib/jobs";

/** True when the click landed on the row background rather than on a control or link. */
export function isBlankClick(event: React.MouseEvent) {
  const target = event.target as HTMLElement;
  return !target.closest("a, button, input, select, textarea, label, [data-no-toggle]");
}

export function JobThumb({ job, version }: { job: Pick<JobRow, "id" | "has_image">; version?: number }) {
  const [open, setOpen] = useState(false);
  if (!job.has_image) {
    return (
      <div className="flex h-12 w-16 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-line-strong bg-surface-2 text-[9px] leading-tight text-faint">
        <ImageOff className="mb-0.5 size-3.5" />
        Applied image
      </div>
    );
  }
  const src = `/api/jobs/${job.id}/applied-image${version ? `?v=${version}` : ""}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-line-strong bg-surface-2"
        title="View applied screenshot"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Applied screenshot" className="size-full object-cover object-top transition group-hover:scale-105" />
      </button>
      {open && <Lightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <button className="btn btn-secondary absolute right-4 top-4 px-2" onClick={onClose} aria-label="Close">
        <X className="size-4" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Applied screenshot" className="max-h-full max-w-full rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

/** assignee: show the member who the job is assigned to ("bidder" on Applying, "caller" on Interviews). */
export function JobHeading({ job, assignee }: { job: JobRow; assignee?: "bidder" | "caller" }) {
  const assignedName = assignee === "bidder" ? job.assigned_bidder_name : assignee === "caller" ? job.assigned_caller_name : null;
  // Only open jobs still need someone; finished ones without an assignee show nothing.
  const needsAssignee = assignee === "bidder" ? job.apply_status === "ready" : job.interview_status === "scheduled";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="truncate text-sm font-semibold">
          {job.company_name} <span className="text-faint">–</span> {job.job_title}
        </span>
        {assignee && (assignedName || needsAssignee) && (
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded px-1.5 text-[10px]",
              assignedName ? "bg-accent/10 text-accent" : "border border-dashed border-amber-400/40 text-amber-200/80",
            )}
            title={assignedName ? `Assigned ${assignee} (change it on the Team page)` : `No ${assignee} assigned yet — assign one on the Team page`}
          >
            <UserRound className="size-2.5" />
            {assignedName ?? `No ${assignee}`}
          </span>
        )}
      </div>
      <a
        href={job.job_link}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted hover:text-accent"
      >
        <span className="truncate">{job.job_link}</span>
        <ExternalLink className="size-3 shrink-0" />
      </a>
    </div>
  );
}

export function DocButton({ job, type }: { job: JobRow; type: "resume" | "cover_letter" }) {
  const available = type === "resume" ? job.has_resume : job.has_cover_letter;
  const label = type === "resume" ? "Resume" : "Cover letter";
  const Icon = type === "resume" ? FileText : Mail;
  if (!available) {
    return (
      <button className="btn btn-secondary w-28" disabled title={`No ${label.toLowerCase()} text was received`}>
        <Icon className="size-3.5" />
        {label}
      </button>
    );
  }
  return (
    <a className="btn btn-secondary w-28" href={`/api/jobs/${job.id}/document?type=${type}`} download>
      <Icon className="size-3.5" />
      {label}
    </a>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function timeAgo(iso: string | null) {
  if (!iso) return "";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
  ];
  let value = seconds;
  for (const [step, unit] of units) {
    if (Math.abs(value) < step) return value <= 5 && unit === "second" ? "just now" : `${value} ${unit}${value === 1 ? "" : "s"} ago`;
    value = Math.round(value / step);
  }
  return `${value} year${value === 1 ? "" : "s"} ago`;
}
