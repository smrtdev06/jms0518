"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, LoaderCircle, Search } from "lucide-react";

export function useUpdateParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("page");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return { update, pending, params };
}

type Option = { value: string; label: string };

export function FilterBar({
  statusLabel,
  statusOptions,
  status,
  search,
  people,
}: {
  statusLabel: string;
  statusOptions: Option[];
  status: string;
  search: string;
  /** e.g. the member's bidders; value "" = everyone (kept in the "who" search param) */
  people?: { label: string; value: string; options: Option[] };
}) {
  const { update, pending } = useUpdateParams();
  const [q, setQ] = useState(search);

  useEffect(() => setQ(search), [search]);
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="label">{statusLabel}</span>
          <select className="input min-w-44" value={status} onChange={(e) => update({ status: e.target.value })}>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {people && (
          <label className="flex flex-col gap-1.5">
            <span className="label">{people.label}</span>
            <select className="input min-w-48" value={people.value} onChange={(e) => update({ who: e.target.value })}>
              {people.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {pending && <LoaderCircle className="mb-2 size-4 animate-spin text-muted" />}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">Search</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            className="input w-full pl-8 lg:w-72"
            placeholder="Company, title or link"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </label>
    </div>
  );
}

export function Pagination({ total, page, size }: { total: number; page: number; size: number }) {
  const { update } = useUpdateParams();
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);

  const numbers: (number | "…")[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) numbers.push(n);
    else if (numbers[numbers.length - 1] !== "…") numbers.push("…");
  }

  return (
    <div className="flex flex-col items-center justify-between gap-3 text-xs text-muted sm:flex-row">
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="text-fg">{from}</span>–<span className="text-fg">{to}</span> of{" "}
          <span className="text-fg">{total}</span>
        </span>
        <select
          className="input h-7 w-auto px-2 text-xs"
          value={size}
          onChange={(e) => update({ size: e.target.value })}
          aria-label="Rows per page"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="btn btn-ghost size-7 px-0"
          disabled={page <= 1}
          onClick={() => update({ page: String(page - 1) }, false)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>
        {numbers.map((n, i) =>
          n === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-faint">
              …
            </span>
          ) : (
            <button
              key={n}
              onClick={() => update({ page: String(n) }, false)}
              className={clsx("btn size-7 px-0", n === page ? "btn-primary" : "btn-ghost")}
            >
              {n}
            </button>
          ),
        )}
        <button
          className="btn btn-ghost size-7 px-0"
          disabled={page >= pages}
          onClick={() => update({ page: String(page + 1) }, false)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
