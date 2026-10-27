"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ExternalLink, FileText, LoaderCircle, Pencil, Search, Trash2 } from "lucide-react";
import { useUpdateParams } from "@/components/list-controls";
import { StatusBadge } from "@/components/status-badge";
import { Field, FormError, Modal, Table, Td, Th, useApi } from "@/components/admin-ui";
import { formatDateTime } from "@/lib/format";

type Job = {
  id: number;
  company_name: string;
  job_title: string;
  job_link: string;
  profile_name: string | null;
  gen_status: string;
  gen_message: string;
  apply_status: string;
  apply_fail_reason: string;
  interview_status: string;
  created_at: string;
  applied_by: string | null;
  has_resume: boolean;
};
type Profile = { id: number; name: string; label: string };
type Filters = { profile: string; gen: string; apply: string; interview: string; q: string };

const GEN_LABEL: Record<string, { label: string; className: string }> = {
  done: { label: "Generated", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  skipped: { label: "Skipped", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  failed: { label: "Failed", className: "border-rose-400/30 bg-rose-400/10 text-rose-200" },
  needs_manual: { label: "Needs input", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  running: { label: "Running", className: "border-sky-400/30 bg-sky-400/10 text-sky-200" },
  queued: { label: "Queued", className: "border-zinc-400/25 bg-zinc-400/10 text-zinc-300" },
};

export function JobsManager({ jobs, profiles, filters }: { jobs: Job[]; profiles: Profile[]; filters: Filters }) {
  const { update, pending } = useUpdateParams();
  const { call, error } = useApi();
  const [q, setQ] = useState(filters.q);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => setSelected([]), [jobs]);
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const allSelected = jobs.length > 0 && selected.length === jobs.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-48" value={filters.profile} onChange={(e) => update({ profile: e.target.value })}>
          <option value="">All profiles</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.label ? ` (${p.label})` : ""}
            </option>
          ))}
        </select>
        <select className="input w-48" value={filters.gen} onChange={(e) => update({ gen: e.target.value })}>
          <option value="">Any tailoring result</option>
          {Object.entries(GEN_LABEL).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select className="input w-40" value={filters.apply} onChange={(e) => update({ apply: e.target.value })}>
          <option value="">Any apply status</option>
          <option value="ready">Ready to Apply</option>
          <option value="applied">Applied</option>
          <option value="failed">Apply failed</option>
        </select>
        <select className="input w-44" value={filters.interview} onChange={(e) => update({ interview: e.target.value })}>
          <option value="">Any interview step</option>
          <option value="unscheduled">Unscheduled</option>
          <option value="scheduled">Scheduled</option>
          <option value="interviewed">Interviewed</option>
          <option value="offered">Offered</option>
          <option value="rejected">Rejected</option>
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input className="input w-60 pl-8" placeholder="Company, title or link" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {pending && <LoaderCircle className="mb-2.5 size-4 animate-spin text-muted" />}
        {selected.length > 0 && (
          <button
            className="btn btn-danger ml-auto"
            onClick={() =>
              window.confirm(`Delete ${selected.length} selected job(s)? Their documents, screenshots and interview details are deleted too.`) &&
              call("/api/admin/jobs/bulk", "POST", { action: "delete", ids: selected })
            }
          >
            <Trash2 className="size-3.5" /> Delete {selected.length}
          </button>
        )}
      </div>
      <FormError error={error} />
      <Table minWidth={1040}>
        <thead>
          <tr>
            <Th className="w-8">
              <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? [] : jobs.map((j) => j.id))} />
            </Th>
            <Th>Job</Th>
            <Th>Profile</Th>
            <Th>Tailoring</Th>
            <Th>Apply</Th>
            <Th>Interview</Th>
            <Th>Submitted</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const gen = GEN_LABEL[j.gen_status] ?? GEN_LABEL.queued;
            return (
              <tr key={j.id} className="hover:bg-surface-2/40">
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${j.company_name || j.job_link}`}
                    checked={selected.includes(j.id)}
                    onChange={() => setSelected(selected.includes(j.id) ? selected.filter((x) => x !== j.id) : [...selected, j.id])}
                  />
                </Td>
                <Td>
                  <div className="font-medium">
                    {j.company_name || <span className="text-faint">Unknown company</span>}
                    {j.job_title && (
                      <>
                        {" "}
                        <span className="text-faint">–</span> {j.job_title}
                      </>
                    )}
                  </div>
                  <a href={j.job_link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-96 items-center gap-1 truncate text-xs text-muted hover:text-accent">
                    <span className="truncate">{j.job_link}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </Td>
                <Td className="whitespace-nowrap text-xs text-muted">{j.profile_name}</Td>
                <Td>
                  <span className={clsx("inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium", gen.className)} title={j.gen_message}>
                    {gen.label}
                  </span>
                </Td>
                <Td>
                  {j.gen_status === "done" ? <StatusBadge status={j.apply_status} /> : <span className="text-xs text-faint">—</span>}
                  {j.apply_status === "failed" && j.apply_fail_reason && (
                    <div className="mt-0.5 max-w-48 truncate text-[11px] text-rose-300/80" title={j.apply_fail_reason}>
                      {j.apply_fail_reason}
                    </div>
                  )}
                  {j.applied_by && <div className="mt-0.5 text-[11px] text-faint">by {j.applied_by}</div>}
                </Td>
                <Td>{j.gen_status === "done" && j.apply_status === "applied" ? <StatusBadge status={j.interview_status} /> : <span className="text-xs text-faint">—</span>}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(j.created_at)}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    {j.has_resume && (
                      <a className="btn btn-ghost px-2" href={`/api/jobs/${j.id}/document?type=zip`} title="Download the package (ZIP)">
                        <FileText className="size-3.5" />
                      </a>
                    )}
                    {j.gen_status === "done" && (
                      <button className="btn btn-ghost px-2" onClick={() => setEditing(j.id)} aria-label="Edit">
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      className="btn btn-ghost px-2 hover:text-rose-300"
                      aria-label="Delete"
                      onClick={() => window.confirm(`Delete "${j.company_name || j.job_link}"?`) && call(`/api/admin/jobs/${j.id}`, "DELETE")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </Td>
              </tr>
            );
          })}
          {jobs.length === 0 && (
            <tr>
              <Td colSpan={8} className="py-10 text-center text-xs text-faint">
                No jobs match these filters.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
      {editing !== null && <EditJobForm id={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditJobForm({ id, onClose }: { id: number; onClose: () => void }) {
  const { call, pending, error } = useApi();
  const [form, setForm] = useState<{ job_link: string; company_name: string; job_title: string } | null>(null);
  const [status, setStatus] = useState({ apply_status: "ready", interview_status: "unscheduled", original: "ready" });

  useEffect(() => {
    fetch(`/api/admin/jobs/${id}`)
      .then((r) => r.json())
      .then((job) => {
        setForm({ job_link: job.job_link, company_name: job.company_name, job_title: job.job_title });
        setStatus({ apply_status: job.apply_status, interview_status: job.interview_status, original: job.apply_status });
      });
  }, [id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status.original === "applied" && status.apply_status === "ready" && !window.confirm("Reset to Ready to Apply? The screenshot and interview details will be removed.")) return;
    if (status.original === "failed" && status.apply_status === "ready" && !window.confirm("Reset to Ready to Apply? The failure reason will be removed.")) return;
    if (await call(`/api/admin/jobs/${id}`, "PATCH", { ...form, ...status })) onClose();
  }

  const set = (key: "job_link" | "company_name" | "job_title") => (e: React.ChangeEvent<HTMLInputElement>) => form && setForm({ ...form, [key]: e.target.value });

  return (
    <Modal title="Edit job" onClose={onClose}>
      {!form ? (
        <div className="flex justify-center py-10">
          <LoaderCircle className="size-5 animate-spin text-muted" />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name">
              <input className="input" value={form.company_name} onChange={set("company_name")} required />
            </Field>
            <Field label="Job title">
              <input className="input" value={form.job_title} onChange={set("job_title")} required />
            </Field>
            <Field label="Job link" className="sm:col-span-2">
              <input className="input" type="url" value={form.job_link} onChange={set("job_link")} required />
            </Field>
            <Field
              label="Apply status"
              hint={status.original === "ready" ? "Jobs become Applied when a screenshot is uploaded, or Failed with a reason, on the Applying page." : undefined}
            >
              <select className="input" value={status.apply_status} onChange={(e) => setStatus({ ...status, apply_status: e.target.value })} disabled={status.original === "ready"}>
                <option value="ready">Ready to Apply</option>
                <option value="applied" disabled={status.original !== "applied"}>Applied</option>
                <option value="failed" disabled={status.original !== "failed"}>Apply failed</option>
              </select>
            </Field>
            <Field label="Interview step" hint="Correct the step manually if needed.">
              <select className="input" value={status.interview_status} onChange={(e) => setStatus({ ...status, interview_status: e.target.value })} disabled={status.apply_status !== "applied"}>
                <option value="unscheduled">Unscheduled</option>
                <option value="scheduled">Scheduled</option>
                <option value="interviewed">Interviewed</option>
                <option value="offered">Offered</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>
          </div>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={pending}>
              Save changes
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
