import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { Table, Td, Th } from "@/components/admin-ui";

export const metadata = { title: "Activity log · Administrator" };

export default async function ActivityPage() {
  const logs = await query<{
    id: number;
    username: string | null;
    action: string;
    entity: string;
    entity_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
    job: string | null;
  }>(
    `SELECT a.id, u.username, a.action, a.entity, a.entity_id, a.details, a.created_at::text,
       CASE WHEN a.entity = 'job' THEN (SELECT j.company_name || ' – ' || j.job_title FROM jobs j WHERE j.id::text = a.entity_id) END AS job
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT 200`,
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Last 200 changes made by users: applications, interview updates and administration.</p>
      <Table minWidth={820}>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>User</Th>
            <Th>Action</Th>
            <Th>Target</Th>
            <Th>Details</Th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => {
            const details = Object.entries(l.details ?? {})
              .filter(([, v]) => v !== "" && v !== null && v !== undefined)
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
              .join(" · ");
            return (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(l.created_at)}</Td>
                <Td className="text-sm">{l.username ?? "—"}</Td>
                <Td className="font-mono text-xs">{l.action}</Td>
                <Td className="max-w-72 truncate text-xs text-muted">{l.job ?? (l.entity_id ? `${l.entity} #${l.entity_id}` : l.entity)}</Td>
                <Td className="max-w-80 truncate text-xs text-faint">{details || "—"}</Td>
              </tr>
            );
          })}
          {logs.length === 0 && (
            <tr>
              <Td colSpan={5} className="py-10 text-center text-xs text-faint">
                No activity yet.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
