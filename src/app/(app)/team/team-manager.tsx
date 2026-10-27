"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { ClipboardList, ExternalLink, Pencil, Phone, Plus, Search, Send, Sparkles, Trash2, UserPlus } from "lucide-react";
import type { TeamActivity } from "@/lib/dashboard";
import type { AssignableJob } from "@/lib/assign";
import { Field, FormError, Modal, Pill, Table, Td, Th, Toggle, useApi } from "@/components/admin-ui";
import { timeAgo } from "@/components/job-parts";

type Totals = { id: number; applied: number; apply_failed: number; results: number };
type Assignable = { bidder: AssignableJob[]; caller: AssignableJob[] };

export function TeamManager({
  people,
  totals,
  assignable,
  sole,
}: {
  people: TeamActivity[];
  totals: Totals[];
  assignable: Assignable;
  /** the only active bidder / caller, who gets every open job automatically */
  sole: { bidder: number | null; caller: number | null };
}) {
  const [editing, setEditing] = useState<TeamActivity | "new" | null>(null);
  const [assigning, setAssigning] = useState<TeamActivity | null>(null);
  const { call, error } = useApi();
  const total = (id: number) => totals.find((t) => t.id === id);
  const bidders = people.filter((p) => p.role === "bidder");
  const callers = people.filter((p) => p.role === "caller");
  const sum = (list: TeamActivity[], key: "applied" | "apply_failed" | "results") => list.reduce((n, p) => n + p[key], 0);
  const openCount = (p: TeamActivity) => assignable[p.role === "caller" ? "caller" : "bidder"].filter((j) => j.assignee_id === p.id).length;
  const unassigned = (kind: keyof Assignable) => assignable[kind].filter((j) => !j.assignee_id).length;

  const tiles = [
    { label: "Bidders", value: bidders.length, hint: `${bidders.filter((b) => b.is_active).length} active · ${unassigned("bidder")} ready jobs unassigned` },
    { label: "Callers", value: callers.length, hint: `${callers.filter((c) => c.is_active).length} active · ${unassigned("caller")} interviews unassigned` },
    { label: "Applications · 7 days", value: sum(bidders, "applied"), hint: `${sum(bidders, "apply_failed")} failed attempts` },
    { label: "Interview results · 7 days", value: sum(callers, "results"), hint: "recorded by callers" },
  ];

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card px-4 py-3">
            <div className="text-xs text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{t.value}</div>
            <div className="mt-0.5 text-[11px] text-faint">{t.hint}</div>
          </div>
        ))}
      </section>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{people.length ? `${people.length} people` : "No bidders or callers yet."}</p>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Add bidder or caller
        </button>
      </div>
      <FormError error={error} />

      {people.length ? (
        <Table minWidth={1040}>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Role</Th>
              <Th>Assigned now</Th>
              <Th className="text-right">Last 7 days</Th>
              <Th className="text-right">All time</Th>
              <Th>Last activity</Th>
              <Th>Last login</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const all = total(p.id);
              return (
                <tr key={p.id} className="hover:bg-surface-2/40">
                  <Td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[11px] text-faint">{p.username}</div>
                  </Td>
                  <Td>
                    <span className={clsx("inline-flex items-center gap-1 text-xs", p.role === "bidder" ? "text-indigo-200" : "text-sky-200")}>
                      {p.role === "bidder" ? <Send className="size-3.5" /> : <Phone className="size-3.5" />}
                      {p.role === "bidder" ? "Bidder" : "Caller"}
                    </span>
                  </Td>
                  <Td>
                    <button
                      className="btn btn-ghost -ml-2 gap-1.5 px-2 text-xs"
                      onClick={() => setAssigning(p)}
                      title={p.role === "caller" ? "Choose the Scheduled interviews this caller attends" : "Choose the Ready to Apply jobs this bidder applies to"}
                    >
                      <ClipboardList className="size-3.5" />
                      <span className="tabular-nums text-fg">{openCount(p)}</span>
                      <span className="text-muted">{p.role === "caller" ? "interviews" : "jobs"} · Assign</span>
                    </button>
                  </Td>
                  <Td className="text-right text-xs tabular-nums">
                    <Work person={p} />
                  </Td>
                  <Td className="text-right text-xs tabular-nums text-muted">{all && <Work person={{ ...p, ...all }} muted />}</Td>
                  <Td className="text-xs text-muted">
                    <span suppressHydrationWarning>{p.last_active ? timeAgo(p.last_active) : "—"}</span>
                  </Td>
                  <Td className="text-xs text-muted">
                    <span suppressHydrationWarning>{p.last_login_at ? timeAgo(p.last_login_at) : "Never"}</span>
                  </Td>
                  <Td>{p.is_active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Disabled</Pill>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button className="btn btn-ghost px-2" onClick={() => setEditing(p)} aria-label="Edit">
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        className="btn btn-ghost px-2 hover:text-rose-300"
                        aria-label="Remove"
                        onClick={() => window.confirm(`Remove ${p.name} from your team? Their past work stays recorded.`) && call(`/api/team/${p.id}`, "DELETE")}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
          <UserPlus className="size-6 text-faint" />
          <p className="text-sm font-medium">Build your team</p>
          <p className="max-w-md text-xs text-muted">Add bidders to apply to your jobs and callers to attend your interviews. Each one signs in with the user ID and password you set.</p>
        </div>
      )}

      {editing && <TeamForm person={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {assigning && (
        <AssignForm
          person={assigning}
          jobs={assignable[assigning.role === "caller" ? "caller" : "bidder"]}
          people={people}
          automatic={sole[assigning.role === "caller" ? "caller" : "bidder"] === assigning.id}
          onClose={() => setAssigning(null)}
        />
      )}
    </div>
  );
}

// Tick the open jobs this person works on. Ticking a job assigned to someone else moves it to this person;
// unticking one of theirs leaves it unassigned. Applied / offered / rejected jobs are not listed (their assignment is final).
function AssignForm({
  person,
  jobs,
  people,
  automatic,
  onClose,
}: {
  person: TeamActivity;
  jobs: AssignableJob[];
  people: TeamActivity[];
  automatic: boolean;
  onClose: () => void;
}) {
  const { call, pending, error } = useApi();
  const isCaller = person.role === "caller";
  const [selected, setSelected] = useState(() => new Set(jobs.filter((j) => j.assignee_id === person.id).map((j) => j.id)));
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "unassigned" | "mine">("all");
  const nameOf = (id: number | null) => (id ? (people.find((p) => p.id === id)?.name ?? "Someone") : null);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (show === "unassigned" && j.assignee_id) return false;
      if (show === "mine" && j.assignee_id !== person.id) return false;
      return !needle || `${j.company_name} ${j.job_title} ${j.job_link}`.toLowerCase().includes(needle);
    });
  }, [jobs, q, show, person.id]);

  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allVisible = visible.length > 0 && visible.every((j) => selected.has(j.id));
  const moving = jobs.filter((j) => selected.has(j.id) && j.assignee_id && j.assignee_id !== person.id).length;

  async function save() {
    const ok = await call("/api/team/assign", "PUT", { user_id: person.id, job_ids: [...selected] });
    if (ok) onClose();
  }

  return (
    <Modal title={`Assign ${isCaller ? "interviews" : "jobs"} to ${person.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          {isCaller
            ? "Only Scheduled interviews can be assigned. The caller sees and works on just these in Interview Schedule."
            : "Only Ready to Apply jobs can be assigned. The bidder sees and works on just these in Applying Management."}{" "}
          Once a job is {isCaller ? "offered or rejected" : "applied"}, its assignment is final.
        </p>
        {automatic && (
          <div className="flex gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg/90">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <span>
              {person.name} is your only active {isCaller ? "caller" : "bidder"}, so every {isCaller ? "Scheduled interview" : "Ready to Apply job"} is
              assigned to them automatically — new ones too. Add another {isCaller ? "caller" : "bidder"} to choose by hand.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input className="input pl-8" placeholder="Search company, title or link" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex rounded-lg border border-line-strong p-0.5 text-xs">
            {(["all", "unassigned", "mine"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setShow(v)}
                className={clsx("rounded-md px-2.5 py-1", show === v ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}
              >
                {v === "all" ? "All" : v === "unassigned" ? "Unassigned" : `${person.name.split(" ")[0]}'s`}
              </button>
            ))}
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">
            {isCaller ? "No Scheduled interviews right now." : "No Ready to Apply jobs right now."}
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-line">
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[11px] uppercase tracking-wide text-faint">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)]"
                      checked={allVisible}
                      disabled={automatic || !visible.length}
                      onChange={(e) => visible.forEach((j) => toggle(j.id, e.target.checked))}
                      aria-label="Select all shown"
                    />
                  </th>
                  <th className="px-2 py-2 font-medium">Job</th>
                  <th className="w-40 px-2 py-2 font-medium">{isCaller ? "Interview" : "Generated"}</th>
                  <th className="w-48 px-3 py-2 font-medium">Assigned to</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((j) => {
                  const on = selected.has(j.id);
                  const current = nameOf(j.assignee_id);
                  const other = j.assignee_id && j.assignee_id !== person.id;
                  return (
                    <tr key={j.id} className={clsx("border-t border-line", on ? "bg-accent/5" : "hover:bg-surface-2/40")}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="accent-[var(--color-accent)]"
                          checked={on}
                          disabled={automatic}
                          onChange={(e) => toggle(j.id, e.target.checked)}
                          aria-label={`Assign ${j.company_name}`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <label className={clsx("block", !automatic && "cursor-pointer")} onClick={() => !automatic && toggle(j.id, !on)}>
                          <span className="block truncate font-medium">{j.company_name || "Unknown company"}</span>
                          <span className="block truncate text-xs text-muted">{j.job_title}</span>
                        </label>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-muted" suppressHydrationWarning>
                        {j.when ? (isCaller ? new Date(j.when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : timeAgo(j.when)) : "—"}
                        <a href={j.job_link} target="_blank" rel="noreferrer" className="ml-2 inline-flex text-faint hover:text-fg" aria-label="Open job posting">
                          <ExternalLink className="size-3" />
                        </a>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {on && other ? (
                          <span className="text-amber-200">
                            {current} → {person.name}
                          </span>
                        ) : on ? (
                          <span className="text-fg">{person.name}</span>
                        ) : j.assignee_id === person.id ? (
                          <span className="text-rose-300/80 line-through">{person.name}</span>
                        ) : (
                          <span className="text-faint">{current ?? "Unassigned"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-xs text-muted">
                      Nothing matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <FormError error={error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            <span className="text-fg tabular-nums">{selected.size}</span> selected
            {moving > 0 && <span className="text-amber-200"> · {moving} moving from another {isCaller ? "caller" : "bidder"}</span>}
          </p>
          <div className="flex gap-2">
            {automatic ? (
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={pending} onClick={save}>
                  Save assignments
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Work({ person, muted }: { person: Pick<TeamActivity, "role" | "applied" | "apply_failed" | "results">; muted?: boolean }) {
  if (person.role === "caller") return <span className={muted ? "" : "text-fg"}>{person.results} results</span>;
  return (
    <span>
      <span className={muted ? "" : "text-fg"}>{person.applied} applied</span>
      {person.apply_failed > 0 && <span className="text-rose-300/80"> · {person.apply_failed} failed</span>}
    </span>
  );
}

function TeamForm({ person, onClose }: { person: TeamActivity | null; onClose: () => void }) {
  const { call, pending, error } = useApi();
  const [form, setForm] = useState({
    username: person?.username ?? "",
    display_name: person?.name && person.name !== person.username ? person.name : "",
    role: person?.role ?? "bidder",
    password: "",
    is_active: person?.is_active ?? true,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = person ? await call(`/api/team/${person.id}`, "PATCH", form) : await call("/api/team", "POST", form);
    if (ok) onClose();
  }

  return (
    <Modal title={person ? `Edit ${person.name}` : "Add bidder or caller"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="User ID (login)">
            <input className="input" value={form.username} disabled={Boolean(person)} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoFocus={!person} />
          </Field>
          <Field label="Display name">
            <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </Field>
          <div className="space-y-1.5 sm:col-span-2">
            <span className="label">Role</span>
            <div className="grid grid-cols-2 gap-2">
              {(["bidder", "caller"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setForm({ ...form, role })}
                  className={clsx(
                    "rounded-lg border px-3 py-2.5 text-left transition",
                    form.role === role ? "border-accent/60 bg-accent/10" : "border-line-strong hover:border-faint",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {role === "bidder" ? <Send className="size-3.5" /> : <Phone className="size-3.5" />}
                    {role === "bidder" ? "Bidder" : "Caller"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {role === "bidder" ? "Applies to your jobs (Applying Management)." : "Attends your interviews (Interview Schedule)."}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <Field label={person ? "New password" : "Password"} hint={person ? "Leave empty to keep the current password." : "At least 6 characters."} className="sm:col-span-2">
            <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!person} />
          </Field>
        </div>
        <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Account active (can sign in)" />
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={pending}>
            {person ? "Save changes" : "Add to team"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
