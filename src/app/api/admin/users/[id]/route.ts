import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { audit, queryOne, transaction } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { parseId, readJson, route } from "@/lib/http";
import { validateUserBody } from "@/lib/validators";
import { assertMember } from "@/lib/team";
import { autoAssign, releaseAssignments } from "@/lib/assign";

type Ctx = { params: Promise<{ id: string }> };

async function assertNotLastAdmin(userId: number) {
  const row = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND id <> $1",
    [userId],
  );
  if (!row?.n) throw new HttpError(409, "At least one active administrator must remain");
}

export const PATCH = route<Ctx>(async (request, { params }) => {
  const admin = await requireApiUser(can.administer);
  const id = parseId((await params).id);
  const input = validateUserBody(await readJson(request), false);
  await assertMember(input.memberId);
  if (input.memberId === id) throw new HttpError(400, "A user cannot be their own member");
  const current = await queryOne<{ role: string; member_id: number | null }>("SELECT role, member_id FROM users WHERE id = $1", [id]);
  if (!current) throw new HttpError(404, "User not found");
  if (current.role === "admin" && (input.role !== "admin" || !input.isActive)) await assertNotLastAdmin(id);

  await transaction(async (db) => {
    await db.query(
      `UPDATE users SET display_name = $2, role = $3, is_active = $4, member_id = $5, profile_label = $6
       WHERE id = $1`,
      [id, input.displayName, input.role, input.isActive, input.memberId, input.profileLabel],
    );
    // A member who becomes another role no longer has a team.
    if (current.role === "member" && input.role !== "member") await db.query("UPDATE users SET member_id = NULL WHERE member_id = $1", [id]);
    if (input.password) {
      await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, await bcrypt.hash(input.password, 10)]);
    }
  });
  // Moved to another role or team: unfinished assignments go back to the member to hand out again.
  if (input.role !== current.role || input.memberId !== current.member_id) await releaseAssignments(id);
  // Both the old and the new member may now have a single bidder or caller.
  await autoAssign(current.member_id);
  if (input.memberId !== current.member_id) await autoAssign(input.memberId);
  await audit(admin.id, "user.updated", "user", id, { role: input.role, memberId: input.memberId, active: input.isActive, passwordChanged: Boolean(input.password) });
  return NextResponse.json({ ok: true });
});

export const DELETE = route<Ctx>(async (_request, { params }) => {
  const admin = await requireApiUser(can.administer);
  const id = parseId((await params).id);
  if (id === admin.id) throw new HttpError(409, "You cannot delete your own account");
  const current = await queryOne<{ role: string; username: string; member_id: number | null }>(
    "SELECT role, username, member_id FROM users WHERE id = $1",
    [id],
  );
  if (!current) throw new HttpError(404, "User not found");
  if (current.role === "admin") await assertNotLastAdmin(id);
  // A member's jobs go with the account (cascade) and their screenshots are removed; their bidders and
  // callers stay without a member (member_id is set to NULL) until they are moved to another member.
  await transaction(async (db) => {
    await db.query(
      "DELETE FROM stored_files WHERE key IN (SELECT 'applied/' || j.id FROM jobs j WHERE j.user_id = $1)",
      [id],
    );
    await db.query("DELETE FROM users WHERE id = $1", [id]);
  });
  await autoAssign(current.member_id);
  await audit(admin.id, "user.deleted", "user", id, { username: current.username });
  return NextResponse.json({ ok: true });
});
