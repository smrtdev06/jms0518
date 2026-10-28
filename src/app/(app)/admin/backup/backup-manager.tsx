"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileArchive, LoaderCircle, RotateCcw, Upload } from "lucide-react";
import { FormError, Modal } from "@/components/admin-ui";

type Table = { key: string; label: string; rows: number };

export function BackupManager({ tables, databaseSize, lastBackup }: { tables: Table[]; databaseSize: string; lastBackup: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState("");

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Download a backup</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-muted">
              One file (.json.gz) with every table: users and profiles, jobs with their resumes and cover letters, screenshots, uploaded templates, bot
              links, settings and the activity log. Keep it somewhere safe — it contains password hashes and personal details.
            </p>
            <p className="mt-1 text-[11px] text-faint">
              Database size {databaseSize} · last backup {lastBackup ?? "never"}
            </p>
          </div>
          <a
            href="/api/admin/backup"
            className="btn btn-primary"
            onClick={() => {
              setDownloading(true);
              setTimeout(() => {
                setDownloading(false);
                router.refresh();
              }, 4000);
            }}
          >
            {downloading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Download backup
          </a>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
          {tables.map((t) => (
            <div key={t.key} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2">
              <dt className="truncate text-[11px] text-muted">{t.label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{t.rows.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card border-rose-500/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Restore a backup</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-muted">
              Replaces <span className="text-rose-200">everything</span> in the database with the backup: data added since the backup is lost. Everyone
              keeps working with the accounts from the backup (you may have to sign in again). Download a backup first if you might need today&apos;s data.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => input.current?.click()}>
            <Upload className="size-3.5" /> Choose backup file
          </button>
          <input
            ref={input}
            type="file"
            accept=".gz,.json,application/gzip,application/json"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setDone("");
              e.target.value = "";
            }}
          />
        </div>
        {done && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            {done}
          </p>
        )}
      </section>

      {file && (
        <RestoreDialog
          file={file}
          onClose={() => setFile(null)}
          onRestored={(message) => {
            setFile(null);
            setDone(message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({ file, onClose, onRestored }: { file: File; onClose: () => void; onRestored: (message: string) => void }) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const size = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;

  async function restore() {
    setPending(true);
    setError("");
    const res = await fetch("/api/admin/backup", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setPending(false);
    if (res?.status === 401 || res?.status === 403) {
      window.location.href = "/login";
      return;
    }
    if (!res?.ok) {
      setError(data.error ?? (res?.status === 413 ? "The file is too large for this host." : "Could not restore the backup."));
      return;
    }
    const r = data.restored as Record<string, number>;
    onRestored(
      `Restored the backup from ${new Date(data.backup_from).toLocaleString()}: ${r.users} users, ${r.jobs} jobs, ${r.job_links} bot links, ` +
        `${r.stored_files} files, ${r.audit_logs} log entries.`,
    );
  }

  return (
    <Modal title="Restore this backup?" onClose={() => !pending && onClose()}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2">
          <FileArchive className="size-5 shrink-0 text-faint" />
          <div className="min-w-0">
            <div className="truncate text-sm">{file.name}</div>
            <div className="text-[11px] text-faint">{size}</div>
          </div>
        </div>
        <p className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Every table is emptied and filled from this file. This cannot be undone.
        </p>
        <label className="block space-y-1.5">
          <span className="label">
            Type <span className="font-mono text-fg">RESTORE</span> to confirm
          </span>
          <input className="input font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus disabled={pending} />
        </label>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={restore} disabled={pending || typed !== "RESTORE"}>
            {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            Restore database
          </button>
        </div>
      </div>
    </Modal>
  );
}
