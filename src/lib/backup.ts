import { gunzipSync, gzipSync } from "node:zlib";
import { query, transaction } from "./db";
import { HttpError } from "./auth";

// Database backup / restore for the administrator, inside the app (a host like Vercel has no pg_dump).
// A backup is gzip-compressed JSON: every row of every table. Binary columns (screenshots, templates) come out of
// json_agg as "\x<hex>" text, which PostgreSQL reads straight back into bytea, so restore needs no special cases.

// Restore order: referenced tables first.
const TABLES = ["users", "settings", "job_links", "jobs", "interview_rounds", "stored_files", "audit_logs"] as const;
type TableName = (typeof TABLES)[number];
const APP = "job-management-system";

type BackupFile = { app: typeof APP; version: 1; created_at: string; tables: Record<TableName, Record<string, unknown>[]> };

export async function tableCounts() {
  const counts = {} as Record<TableName, number>;
  for (const table of TABLES) counts[table] = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
  return counts;
}

/** The whole database as a .json.gz file. */
export async function createBackup() {
  const tables = {} as BackupFile["tables"];
  for (const table of TABLES) {
    const [row] = await query<{ rows: Record<string, unknown>[] }>(`SELECT COALESCE(json_agg(t), '[]'::json) AS rows FROM ${table} t`);
    tables[table] = row.rows;
  }
  const file: BackupFile = { app: APP, version: 1, created_at: new Date().toISOString(), tables };
  return gzipSync(JSON.stringify(file));
}

/** Reads a backup (.json.gz or plain .json) and checks it is one of ours, with an administrator to sign in with. */
export function readBackup(data: Buffer): BackupFile {
  let file: BackupFile;
  try {
    const text = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data).toString("utf8") : data.toString("utf8");
    file = JSON.parse(text);
  } catch {
    throw new HttpError(400, "This is not a backup file (expected .json.gz from this page)");
  }
  if (file?.app !== APP || !file.tables || typeof file.tables !== "object") throw new HttpError(400, "This file is not a Job Management System backup");
  for (const table of TABLES) {
    if (file.tables[table] === undefined) file.tables[table] = [];
    if (!Array.isArray(file.tables[table])) throw new HttpError(400, `The backup's ${table} table is damaged`);
  }
  if (!file.tables.users.some((u) => u.role === "admin" && u.is_active !== false)) {
    throw new HttpError(400, "The backup has no active administrator, so nobody could sign in after restoring it");
  }
  return file;
}

/**
 * Replaces every table with the backup's rows, all in one transaction (any error leaves the database as it was).
 * Columns the backup does not have get their defaults, so backups made before a schema change still restore.
 */
export async function restoreBackup(file: BackupFile) {
  return transaction(async (db) => {
    await db.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    const restored = {} as Record<TableName, number>;
    for (const table of TABLES) {
      const rows = file.tables[table];
      restored[table] = rows.length;
      if (!rows.length) continue;
      const { rows: cols } = await db.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
        [table],
      );
      const inBackup = new Set(rows.flatMap((row) => Object.keys(row)));
      const columns = cols.map((c) => c.column_name).filter((c) => inBackup.has(c));
      const list = columns.map((c) => `"${c}"`).join(", ");
      await db.query(`INSERT INTO ${table} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${table}, $1::json)`, [JSON.stringify(rows)]);
      // New rows continue after the restored ids.
      if (cols.some((c) => c.column_name === "id")) {
        await db.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`);
      }
    }
    return restored;
  });
}
