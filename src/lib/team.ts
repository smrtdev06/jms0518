import { query, queryOne } from "./db";
import { HttpError } from "./auth";

// Bidders and callers belong to one member (their client).

export async function assertMember(memberId: number | null) {
  if (memberId === null) return;
  const member = await queryOne("SELECT 1 FROM users WHERE id = $1 AND role = 'member'", [memberId]);
  if (!member) throw new HttpError(400, "That member does not exist");
}

/** Throws 404 unless the user is a bidder or caller on this member's team. */
export async function assertTeamMember(memberId: number, userId: number) {
  const row = await queryOne<{ role: string; username: string }>(
    "SELECT role, username FROM users WHERE id = $1 AND member_id = $2 AND role IN ('bidder', 'caller')",
    [userId, memberId],
  );
  if (!row) throw new HttpError(404, "Team member not found");
  return row;
}

/**
 * The member's people filter for Applying Management (bidders) or Interview Schedule (callers):
 * "" = everyone, "none" = unassigned, or one of the team. Returns the choice and the select options.
 */
export async function teamFilter(memberId: number, role: "bidder" | "caller", requested: string) {
  const team = await query<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, COALESCE(NULLIF(display_name, ''), username) AS name, is_active FROM users
     WHERE member_id = $1 AND role = $2 ORDER BY is_active DESC, name`,
    [memberId, role],
  );
  const plural = role === "bidder" ? "bidders" : "callers";
  const options = [
    { value: "", label: `All ${plural}` },
    { value: "none", label: "Unassigned" },
    ...team.map((t) => ({ value: String(t.id), label: t.is_active ? t.name : `${t.name} (disabled)` })),
  ];
  const value = options.some((o) => o.value === requested) ? requested : "";
  const userId = value === "" ? undefined : value === "none" ? null : Number(value);
  return { value, options, userId };
}
