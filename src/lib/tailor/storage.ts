import fs from "node:fs/promises";
import path from "node:path";
import { query } from "@/lib/db";
import { templateDir } from "./paths";

// Files, by key, in the stored_files table (one database for everything):
//   applied/<job>              the applied screenshot
//   templates/<file>           uploaded template PDFs and the styles read from them
// Templates fall back to the copies in templates/ until one is uploaded. Resumes, cover letters and
// ZIPs are not stored: they are built from jobs.tailored when downloaded (see pack.ts).

type Store = {
  put(key: string, bytes: Buffer | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  // Last change in milliseconds, 0 when missing.
  modified(key: string): Promise<number>;
};

export const templateKey = (file: string) => `templates/${file}`;
export const appliedKey = (jobId: number) => `applied/${jobId}`;

function guessType(key: string) {
  if (key.endsWith(".pdf")) return "application/pdf";
  if (key.endsWith(".zip")) return "application/zip";
  if (key.endsWith(".json")) return "application/json";
  return "text/plain; charset=utf-8";
}

// Templates deployed with the code; read only.
async function bundledTemplate(key: string) {
  if (!key.startsWith("templates/")) return null;
  return fs.readFile(path.join(templateDir, path.basename(key))).catch(() => null);
}

export const storage: Store = {
  async put(key, bytes, contentType) {
    await query(
      `INSERT INTO stored_files (key, data, content_type, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, updated_at = now()`,
      [key, typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes, contentType || guessType(key)],
    );
  },
  async get(key) {
    const rows = await query<{ data: Buffer }>("SELECT data FROM stored_files WHERE key = $1", [key]);
    return rows[0]?.data ?? (await bundledTemplate(key));
  },
  async modified(key) {
    const rows = await query<{ ms: string }>("SELECT (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS ms FROM stored_files WHERE key = $1", [key]);
    if (rows[0]) return Number(rows[0].ms);
    // A deployed template counts as older than any upload.
    return (await bundledTemplate(key)) ? 1 : 0;
  },
};

export async function getFile(key: string) {
  const rows = await query<{ data: Buffer; content_type: string }>("SELECT data, content_type FROM stored_files WHERE key = $1", [key]);
  return rows[0] ?? null;
}

// Removes the screenshots of jobs that were deleted.
export async function removeJobFiles(jobIds: number[]) {
  if (!jobIds.length) return;
  await query("DELETE FROM stored_files WHERE key = ANY($1::text[])", [jobIds.map(appliedKey)]);
}
