import { query } from "@/lib/db";
import { requirePageUser, can } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { UsersManager } from "./users-manager";

export const metadata = { title: "Users · Administrator" };

export default async function UsersPage() {
  const me = await requirePageUser(can.administer);
  // Members first, each followed by their bidders and callers; then administrators, bosses and unattached team members.
  const users = await query<{
    id: number;
    username: string;
    display_name: string;
    role: Role;
    is_active: boolean;
    last_login_at: string | null;
    member_id: number | null;
    member_name: string | null;
    profile_label: string;
    full_name: string | null;
    team_size: number;
    generated: number;
    applied: number;
    profile_email: string;
    gmail_email: string | null;
    gmail_error: string | null;
  }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.last_login_at::text, u.member_id,
       COALESCE(m.full_name, NULLIF(m.display_name, ''), m.username) AS member_name, u.profile_label, u.full_name,
       (SELECT count(*)::int FROM users t WHERE t.member_id = u.id) AS team_size,
       (SELECT count(*)::int FROM jobs j WHERE j.user_id = u.id AND j.gen_status = 'done') AS generated,
       (SELECT count(*)::int FROM jobs j WHERE j.applied_by = u.id) AS applied,
       u.email AS profile_email, g.email AS gmail_email, g.last_error AS gmail_error
     FROM users u LEFT JOIN users m ON m.id = u.member_id
     LEFT JOIN gmail_accounts g ON g.member_id = u.id
     ORDER BY array_position(ARRAY['admin', 'boss', 'member', 'bidder', 'caller'], u.role), u.username`,
  );
  const members = users.filter((u) => u.role === "member").map((u) => ({ id: u.id, name: u.full_name || u.display_name || u.username, username: u.username }));
  return <UsersManager users={users} members={members} currentUserId={me.id} />;
}
