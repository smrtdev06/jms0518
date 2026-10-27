"use client";

import { useState } from "react";
import clsx from "clsx";
import { Briefcase, Check, Copy, GraduationCap, Link2, Mail, MapPin, Phone, UserRound } from "lucide-react";
import type { ProfileSummary } from "@/lib/access";

type ProfileStat = { label: string; value: number; tone?: "accent" | "good" | "warn" | "bad" };

const TONE = {
  accent: "text-accent",
  good: "text-emerald-300",
  warn: "text-amber-200",
  bad: "text-rose-300",
} as const;

// The one profile this page works on, instead of a profile filter: who the jobs are for, the details a bidder
// types into application forms (one click copies each), and how many jobs are at each step.
export function ProfileCard({ profile, stats, note }: { profile: ProfileSummary | null; stats: ProfileStat[]; note?: string }) {
  if (!profile) {
    return (
      <div className="card flex items-center gap-3 px-4 py-3 text-sm text-muted">
        <UserRound className="size-4 text-faint" />
        No profile yet — you are not on a member&apos;s team, or the member has not saved their profile.
      </div>
    );
  }
  const initials = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  const headline = [profile.title, profile.company].filter(Boolean).join(" at ");
  const education = [profile.degree, profile.school].filter(Boolean).join(", ");

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3 lg:w-72 lg:shrink-0">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400/80 to-sky-400/70 text-sm font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{profile.name}</span>
              {profile.label && <span className="rounded bg-accent/10 px-1.5 text-[10px] font-medium text-accent">{profile.label}</span>}
            </div>
            {headline && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                <Briefcase className="size-3 shrink-0 text-faint" />
                <span className="truncate">{headline}</span>
              </div>
            )}
            {education && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-faint">
                <GraduationCap className="size-3 shrink-0" />
                <span className="truncate">{education}</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2 lg:border-l lg:border-line lg:pl-4">
          <CopyField icon={Mail} label="Email" value={profile.email} />
          <CopyField icon={Phone} label="Phone" value={profile.phone} />
          <CopyField icon={MapPin} label="Location" value={profile.address} />
          <CopyField icon={Link2} label="LinkedIn" value={profile.linkedin} />
        </div>

        {stats.length > 0 && (
          <dl className="flex shrink-0 gap-2 lg:border-l lg:border-line lg:pl-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-16 rounded-lg bg-surface-2/60 px-3 py-1.5 text-center">
                <dd className={clsx("text-lg font-semibold tabular-nums", s.value && s.tone ? TONE[s.tone] : s.value ? "text-fg" : "text-faint")}>
                  {s.value}
                </dd>
                <dt className="text-[10px] uppercase tracking-wide text-muted">{s.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
      {note && <div className="border-t border-line bg-surface-2/30 px-4 py-2 text-[11px] text-muted">{note}</div>}
    </section>
  );
}

function CopyField({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-faint">
        <Icon className="size-3.5 shrink-0" />
        No {label.toLowerCase()}
      </div>
    );
  }
  return (
    <button
      type="button"
      title={`Copy ${label.toLowerCase()}`}
      onClick={() =>
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => undefined,
        )
      }
      className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition hover:bg-surface-2"
    >
      <Icon className="size-3.5 shrink-0 text-faint" />
      <span className="truncate text-fg/90">{value.replace(/^https?:\/\/(www\.)?/, "")}</span>
      {copied ? (
        <Check className="ml-auto size-3.5 shrink-0 text-emerald-300" />
      ) : (
        <Copy className="ml-auto size-3.5 shrink-0 text-faint opacity-0 transition group-hover:opacity-100" />
      )}
    </button>
  );
}
