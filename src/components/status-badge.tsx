import clsx from "clsx";

const STYLES: Record<string, { label: string; className: string }> = {
  ready: { label: "Ready to Apply", className: "border-indigo-400/30 bg-indigo-400/15 text-indigo-200" },
  applied: { label: "Applied", className: "border-zinc-400/25 bg-zinc-400/10 text-zinc-300" },
  failed: { label: "Failed", className: "border-rose-400/40 bg-rose-500/15 text-rose-200" },
  unscheduled: { label: "Unscheduled", className: "border-zinc-400/25 bg-zinc-400/10 text-zinc-300" },
  scheduled: { label: "Scheduled", className: "border-violet-400/35 bg-violet-400/15 text-violet-200" },
  interviewed: { label: "Interviewed", className: "border-sky-400/35 bg-sky-400/15 text-sky-200" },
  offered: { label: "Offered", className: "border-emerald-400/35 bg-emerald-400/15 text-emerald-200" },
  rejected: { label: "Rejected", className: "border-rose-400/35 bg-rose-400/15 text-rose-200" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = STYLES[status] ?? { label: status, className: "border-line text-muted" };
  return (
    <span
      className={clsx(
        "inline-flex h-6 min-w-24 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium",
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
