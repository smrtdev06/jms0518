"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import { useUpdateParams } from "@/components/list-controls";
import { Field, FormError, Modal, Pill, Table, Td, Th, useApi } from "@/components/admin-ui";
import { formatDateTime } from "@/lib/format";

type Link = { id: number; job_link: string; created_at: string; tailored: number };

export function BotLinksManager({ links, q: initialQ, total, saved }: { links: Link[]; q: string; total: number; saved: number }) {
  const { update, pending } = useUpdateParams();
  const { call, error } = useApi();
  const [q, setQ] = useState(initialQ);
  const [selected, setSelected] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => setSelected([]), [links]);
  useEffect(() => {
    if (q === initialQ) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const allSelected = links.length > 0 && selected.length === links.length;

  async function remove(ids: number[] | "all") {
    const label = ids === "all" ? `all ${saved.toLocaleString()} saved links` : ids.length === 1 ? "this link" : `${ids.length} links`;
    if (!window.confirm(`Delete ${label}? Jobs already tailored from them are not affected.`)) return;
    const data = await call<{ deleted: number }>("/api/admin/job-links", "DELETE", ids === "all" ? { all: true } : { ids });
    if (data) setNotice(`Deleted ${data.deleted} ${data.deleted === 1 ? "link" : "links"}.`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input className="input w-72 pl-8" placeholder="Search links" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {pending && <LoaderCircle className="size-4 animate-spin text-muted" />}
        <span className="text-xs text-muted">{q ? `${total.toLocaleString()} of ${saved.toLocaleString()} match` : `${saved.toLocaleString()} links`}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {selected.length > 0 && (
            <button className="btn btn-danger" onClick={() => remove(selected)}>
              <Trash2 className="size-3.5" /> Delete {selected.length}
            </button>
          )}
          <button className="btn btn-ghost hover:text-rose-300" onClick={() => remove("all")} disabled={!saved}>
            <Trash2 className="size-3.5" /> Delete all
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add links
          </button>
        </div>
      </div>
      {notice && <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">{notice}</p>}
      <FormError error={error} />

      <Table minWidth={820}>
        <thead>
          <tr>
            <Th className="w-8">
              <input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? [] : links.map((l) => l.id))} />
            </Th>
            <Th className="w-16">ID</Th>
            <Th>Job link</Th>
            <Th>Tailored</Th>
            <Th>Saved</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {links.map((l) => (
            <tr key={l.id} className="hover:bg-surface-2/40">
              <Td>
                <input
                  type="checkbox"
                  aria-label={`Select ${l.job_link}`}
                  checked={selected.includes(l.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.id] : s.filter((id) => id !== l.id)))}
                />
              </Td>
              <Td className="font-mono text-xs text-faint">{l.id}</Td>
              <Td>
                <a href={l.job_link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[40rem] items-center gap-1 text-xs text-fg/90 hover:text-accent">
                  <span className="truncate">{l.job_link}</span>
                  <ExternalLink className="size-3 shrink-0 text-faint" />
                </a>
              </Td>
              <Td>{l.tailored ? <Pill tone="good">{l.tailored === 1 ? "1 profile" : `${l.tailored} profiles`}</Pill> : <span className="text-xs text-faint">—</span>}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(l.created_at)}</Td>
              <Td className="text-right">
                <button className="btn btn-ghost px-2 hover:text-rose-300" aria-label="Delete" onClick={() => remove([l.id])}>
                  <Trash2 className="size-3.5" />
                </button>
              </Td>
            </tr>
          ))}
          {links.length === 0 && (
            <tr>
              <Td colSpan={6} className="py-10 text-center text-xs text-faint">
                {q ? "No links match." : "No links yet. The bot adds them through the API, or add some here."}
              </Td>
            </tr>
          )}
        </tbody>
      </Table>

      {adding && <AddLinks onClose={() => setAdding(false)} onDone={setNotice} />}
    </div>
  );
}

function AddLinks({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const { call, pending, error } = useApi();
  const [text, setText] = useState("");
  const found = (text.match(/https?:\/\/\S+/gi) ?? []).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const data = await call<{ saved: number; skipped: number }>("/api/admin/job-links", "POST", { text });
    if (!data) return;
    onDone(`Added ${data.saved} ${data.saved === 1 ? "link" : "links"}${data.skipped ? `, ${data.skipped} already saved were skipped` : ""}.`);
    onClose();
  }

  return (
    <Modal title="Add job links" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Text with job links" hint="Paste any text — every http(s) link in it is saved, like the bot does. Links already saved are skipped.">
          <textarea
            className="input h-auto min-h-48 resize-y py-2 font-mono text-xs leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"https://job-boards.greenhouse.io/…/jobs/123\nhttps://jobs.lever.co/…"}
            autoFocus
            spellCheck={false}
          />
        </Field>
        <FormError error={error} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">{found ? `${found} ${found === 1 ? "link" : "links"} found` : "No links yet"}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={pending || !found}>
              {pending && <LoaderCircle className="size-3.5 animate-spin" />}
              Add links
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
