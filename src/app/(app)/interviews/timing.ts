"use client";

import { useEffect, useState } from "react";
import type { JobRow } from "@/lib/jobs";
import { zonedToUtc } from "@/lib/timezones";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// When the interview starts and ends, as real instants. Without an end time it lasts an hour;
// without a start time it covers the whole day.
export function interviewWindow(job: Pick<JobRow, "interview_date" | "interview_start" | "interview_end" | "interview_timezone">) {
  if (!job.interview_date) return null;
  const tz = job.interview_timezone || "America/New_York";
  const start = zonedToUtc(job.interview_date, job.interview_start || "00:00", tz);
  if (!start) return null;
  const end = job.interview_end
    ? zonedToUtc(job.interview_date, job.interview_end, tz)
    : job.interview_start
      ? new Date(start.getTime() + HOUR)
      : zonedToUtc(job.interview_date, "23:59", tz);
  return { start, end: end ?? new Date(start.getTime() + HOUR) };
}

// The current time, refreshed every 30 seconds so time badges move on their own.
// null until the page is running in the browser (avoids a server/browser mismatch).
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type Timing = { text: string; tone: string; pulse?: string };

const TONES = {
  later: "border-line text-muted bg-surface-2",
  tomorrow: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  today: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  soon: "border-orange-400/40 bg-orange-500/15 text-orange-200",
  live: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
  justEnded: "border-violet-400/35 bg-violet-400/10 text-violet-200",
  needsResult: "border-rose-400/40 bg-rose-500/15 text-rose-200",
  done: "border-line bg-transparent text-faint",
};

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function span(ms: number) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

// The badge next to the interview time, by where "now" is relative to the interview.
export function interviewTiming(window: { start: Date; end: Date }, now: Date, hasResult: boolean): Timing {
  const t = now.getTime();
  const { start, end } = window;
  if (t >= start.getTime() && t < end.getTime()) return { text: "In progress", tone: TONES.live, pulse: "bg-emerald-400" };
  if (t >= end.getTime()) {
    const ago = t - end.getTime();
    if (ago < 2 * HOUR) return { text: `Ended ${span(ago)} ago`, tone: TONES.justEnded };
    if (!hasResult) return { text: "Ended · add result", tone: TONES.needsResult, pulse: "bg-rose-400" };
    return { text: `Done · ${span(ago)} ago`, tone: TONES.done };
  }
  const until = start.getTime() - t;
  if (until <= HOUR) return { text: `Starts in ${span(until)}`, tone: TONES.soon, pulse: "bg-orange-400" };
  const days = Math.round((dayStart(start) - dayStart(now)) / 86_400_000);
  if (days === 0) return { text: `Today · in ${span(until)}`, tone: TONES.today };
  if (days === 1) return { text: "Tomorrow", tone: TONES.tomorrow };
  return { text: `In ${days} days`, tone: TONES.later };
}
