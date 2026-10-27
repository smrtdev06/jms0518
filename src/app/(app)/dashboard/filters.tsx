"use client";

import { LoaderCircle } from "lucide-react";
import clsx from "clsx";
import { useUpdateParams } from "@/components/list-controls";

const RANGES = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
  { value: "all", label: "All" },
];

export function DashboardFilters({
  profiles,
  showProfiles,
  profile,
  range,
}: {
  profiles: { id: number; name: string; label: string }[];
  showProfiles: boolean;
  profile: string;
  range: string;
}) {
  const { update, pending } = useUpdateParams();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending && <LoaderCircle className="size-4 animate-spin text-muted" />}
      {showProfiles && (
        <select className="input w-56" value={profile} onChange={(e) => update({ profile: e.target.value === "all" ? null : e.target.value })} aria-label="Profile">
          <option value="all">All profiles</option>
          {profiles.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
              {p.label ? ` (${p.label})` : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => update({ range: r.value === "30" ? null : r.value })}
            className={clsx(
              "h-7 rounded-md px-2.5 text-xs font-medium transition",
              range === r.value ? "bg-surface-3 text-fg shadow" : "text-muted hover:text-fg",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
