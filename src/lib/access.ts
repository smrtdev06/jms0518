import { query, queryOne } from "./db";
import { type SessionUser } from "./auth";
import { HttpError } from "./errors";
import { can } from "./roles";
import type { AssigneeFilter } from "./jobs";

// A profile is a member's resume tailor profile (one member = one profile). A member works on their own
// profile; their bidders and callers work on their member's profile; administrators and bosses see all.
type ProfileOption = { id: number; name: string; label: string };

const PROFILE_SELECT = `SELECT p.id, p.full_name AS name, p.profile_label AS label FROM users p
  WHERE p.role = 'member' AND p.is_active AND p.full_name IS NOT NULL`;

export async function allProfiles(): Promise<ProfileOption[]> {
  return query<ProfileOption>(`${PROFILE_SELECT} ORDER BY p.full_name`);
}

/** The member whose profile this user works on (null for administrators and bosses). */
async function profileOwnerId(user: SessionUser): Promise<number | null> {
  if (user.role === "member") return user.id;
  if (user.role === "bidder" || user.role === "caller") {
    const row = await queryOne<{ member_id: number | null }>("SELECT member_id FROM users WHERE id = $1", [user.id]);
    return row?.member_id ?? -1; // -1: not attached to a member, so no profile
  }
  return null;
}

export async function accessibleProfiles(user: SessionUser): Promise<ProfileOption[]> {
  if (can.seeAllProfiles(user.role)) return allProfiles();
  const owner = await profileOwnerId(user);
  return query<ProfileOption>(`${PROFILE_SELECT} AND p.id = $1`, [owner]);
}

export type ProfileSummary = {
  id: number;
  name: string;
  label: string;
  email: string;
  phone: string;
  address: string;
  linkedin: string;
  title: string | null;
  company: string | null;
  school: string | null;
  degree: string | null;
};

/** The one profile a member, bidder or caller works on, with what is handy while applying (null: none yet). */
export async function workProfile(user: SessionUser): Promise<ProfileSummary | null> {
  const owner = await profileOwnerId(user);
  if (!owner || owner < 0) return null;
  return queryOne<ProfileSummary>(
    `SELECT p.id, p.full_name AS name, p.profile_label AS label, p.email, p.phone, p.address, p.linkedin,
       p.experiences -> 0 ->> 'jobTitle' AS title, p.experiences -> 0 ->> 'companyName' AS company,
       p.education -> 0 ->> 'universityName' AS school, p.education -> 0 ->> 'degree' AS degree
     FROM users p WHERE p.id = $1 AND p.role = 'member' AND p.full_name IS NOT NULL`,
    [owner],
  );
}

/** Bidders and callers work only on the jobs their member assigned to them (see lib/assign.ts). */
export function assigneeFilter(user: SessionUser): (AssigneeFilter & { userId: number }) | undefined {
  if (user.role === "bidder") return { column: "assigned_bidder_id", userId: user.id };
  if (user.role === "caller") return { column: "assigned_caller_id", userId: user.id };
  return undefined;
}

/**
 * Throws 404 when the job does not exist, is not generated yet, belongs to another member's profile,
 * or (for bidders and callers) is not assigned to the user.
 */
export async function assertJobAccess(user: SessionUser, jobId: number) {
  const job = await queryOne<{
    id: number;
    user_id: number;
    apply_status: string;
    gen_status: string;
    assigned_bidder_id: number | null;
    assigned_caller_id: number | null;
  }>("SELECT id, user_id, apply_status, gen_status, assigned_bidder_id, assigned_caller_id FROM jobs WHERE id = $1", [jobId]);
  if (!job || job.gen_status !== "done") throw new HttpError(404, "Job not found");
  if (!can.seeAllProfiles(user.role) && job.user_id !== (await profileOwnerId(user))) throw new HttpError(404, "Job not found");
  const assignee = assigneeFilter(user);
  if (assignee && job[assignee.column] !== user.id) throw new HttpError(404, "Job not found");
  return job;
}
