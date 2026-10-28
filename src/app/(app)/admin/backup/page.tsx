import { tableCounts } from "@/lib/backup";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { BackupManager } from "./backup-manager";

export const metadata = { title: "Backup · Administrator" };

const LABELS: Record<string, string> = {
  users: "Users",
  jobs: "Jobs",
  interview_rounds: "Interview rounds",
  job_links: "Bot links",
  stored_files: "Screenshots & templates",
  settings: "Settings",
  audit_logs: "Activity log",
};

export default async function BackupPage() {
  const [counts, [size], [last]] = await Promise.all([
    tableCounts(),
    query<{ size: string }>("SELECT pg_size_pretty(pg_database_size(current_database())) AS size"),
    query<{ created_at: string | null; username: string | null }>(
      `SELECT a.created_at::text, u.username FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action = 'db.backup_downloaded' ORDER BY a.created_at DESC LIMIT 1`,
    ).then((rows) => (rows.length ? rows : [{ created_at: null, username: null }])),
  ]);
  return (
    <BackupManager
      tables={Object.entries(counts).map(([key, rows]) => ({ key, label: LABELS[key] ?? key, rows }))}
      databaseSize={size.size}
      lastBackup={last.created_at ? `${formatDateTime(last.created_at)}${last.username ? ` by ${last.username}` : ""}` : null}
    />
  );
}
