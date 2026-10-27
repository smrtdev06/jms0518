import { query, transaction } from "@/lib/db";
import { normalizeCompany } from "@/lib/normalize";
import { getSettings } from "@/lib/settings";

// A link is skipped when it is already registered, or when a job from the same company was registered
// within the cooldown (Administrator → Settings). Scope: the same profile, or all profiles.
// "Registered" means generated (done), or already past the company check in a running batch.

export type Duplicate = { message: string };

const fmtDate = (value: Date) => value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export async function duplicateLink(userPk: number, jobId: number): Promise<Duplicate | null> {
  const { duplicate_scope } = await getSettings();
  const scoped = duplicate_scope === "profile";
  const rows = await query<{ company_name: string; job_title: string; full_name: string | null; on_board: boolean }>(
    `SELECT o.company_name, o.job_title, u.full_name, o.on_board
     FROM jobs me
     JOIN jobs o ON o.job_link_normalized = me.job_link_normalized AND o.id <> me.id
     JOIN users u ON u.id = o.user_id
     WHERE me.id = $1
       AND (o.gen_status = 'done' OR (o.on_board AND o.user_id = me.user_id AND o.id < me.id AND o.gen_status IN ('queued', 'running', 'needs_manual')))
       ${scoped ? "AND o.user_id = $2" : ""}
     ORDER BY o.id LIMIT 1`,
    scoped ? [jobId, userPk] : [jobId],
  );
  const hit = rows[0];
  if (!hit) return null;
  const what = hit.company_name ? ` (${hit.company_name}${hit.job_title ? ` – ${hit.job_title}` : ""})` : "";
  const who = !scoped && hit.full_name ? ` for ${hit.full_name}` : "";
  return { message: `Skipped: this link is already registered${who}${what}.` };
}

// Checks the company and, when it is free, records it on this job in the same locked step, so two links
// for one company in the same batch cannot both pass.
export async function claimCompany(userPk: number, jobId: number, company: string): Promise<Duplicate | null> {
  const { company_cooldown_days, duplicate_scope } = await getSettings();
  const key = normalizeCompany(company) || company.trim().toLowerCase();
  const scoped = duplicate_scope === "profile";
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`company:${scoped ? `${userPk}:` : ""}${key}`]);
    if (company_cooldown_days > 0 && key && key !== "company") {
      const { rows } = await db.query<{ company_name: string; job_title: string; at: Date; full_name: string | null }>(
        `SELECT j.company_name, j.job_title, COALESCE(j.generated_at, j.updated_at) AS at, u.full_name
         FROM jobs j JOIN users u ON u.id = j.user_id
         WHERE j.company_normalized = $1 AND j.id <> $2
           AND (
             (j.gen_status = 'done' AND j.generated_at > now() - make_interval(days => $3::int))
             OR (j.gen_status = 'running' AND j.gen_step IN ('generate', 'validate', 'zip'))
           )
           ${scoped ? "AND j.user_id = $4" : ""}
         ORDER BY at DESC LIMIT 1`,
        scoped ? [key, jobId, company_cooldown_days, userPk] : [key, jobId, company_cooldown_days],
      );
      const hit = rows[0];
      if (hit) {
        const who = !scoped && hit.full_name ? ` for ${hit.full_name}` : "";
        return {
          message: `Skipped: ${hit.company_name} was already registered${who} on ${fmtDate(new Date(hit.at))} (${hit.job_title || "another role"}), within the ${company_cooldown_days}-day company cooldown.`,
        };
      }
    }
    await db.query("UPDATE jobs SET company_normalized = $3, gen_step = 'generate' WHERE id = $1 AND user_id = $2", [jobId, userPk, key]);
    return null;
  });
}
