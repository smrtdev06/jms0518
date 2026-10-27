"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { X } from "lucide-react";

/** fetch wrapper for admin forms: JSON or FormData body, error message, refresh on success. */
export function useApi() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const call = useCallback(
    async <T = Record<string, unknown>,>(url: string, method: string, body?: unknown): Promise<T | null> => {
      setPending(true);
      setError("");
      const isForm = body instanceof FormData;
      const res = await fetch(url, {
        method,
        headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      setPending(false);
      if (!res?.ok) {
        setError(data.error ?? "Something went wrong");
        return null;
      }
      router.refresh();
      return data as T;
    },
    [router],
  );
  return { call, pending, error, setError };
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:pt-16" onMouseDown={onClose}>
      <div
        className={clsx("card w-full bg-surface p-5 shadow-2xl shadow-black/50", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("flex flex-col gap-1.5", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function FormError({ error }: { error: string }) {
  if (!error) return null;
  return <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-5 w-9 rounded-full transition", checked ? "bg-accent-strong" : "bg-surface-3")}
      >
        <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white transition", checked ? "left-4.5" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Table({ children, minWidth = 720 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={clsx("border-b border-line px-4 py-2.5 text-left text-xs font-medium text-muted", className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={clsx("border-b border-line/60 px-4 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "accent" }) {
  const tones = {
    neutral: "border-line-strong bg-surface-2 text-muted",
    good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    bad: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    accent: "border-indigo-400/30 bg-indigo-400/10 text-indigo-200",
  };
  return <span className={clsx("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}
