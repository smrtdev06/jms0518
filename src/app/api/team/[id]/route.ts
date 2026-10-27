import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { audit, query } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { parseId, readJson, route } from "@/lib/http";
import { validateUserBody } from "@/lib/validators";
import { assertTeamMember } from "@/lib/team";
import { autoAssign, releaseAssignments } from "@/lib/assign";

type Ctx = { params: Promise<{ id: string }> };

// A member edits one of their own bidders or callers (name, role, password, active).
export const PATCH = route<Ctx>(async (request, { params }) => {
  const member = await requireApiUser(can.manageTeam);
  const id = parseId((await params).id);
  const target = await assertTeamMember(member.id, id);
  const input = validateUserBody({ ...(await readJson(request)), member_id: member.id }, false, ["bidder", "caller"]);
  await query("UPDATE users SET display_name = $2, role = $3, is_active = $4 WHERE id = $1", [id, input.displayName, input.role, input.isActive]);
  // A bidder who becomes a caller (or the other way round) hands back their unfinished assignments.
  if (input.role !== target.role) await releaseAssignments(id);
  if (input.password) await query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, await bcrypt.hash(input.password, 10)]);
  await autoAssign(member.id);
  await audit(member.id, "team.updated", "user", id, { role: input.role, active: input.isActive, passwordChanged: Boolean(input.password) });
  return NextResponse.json({ ok: true });
});

// A member removes one of their own bidders or callers. Their work (applications, results) stays.
export const DELETE = route<Ctx>(async (_request, { params }) => {
  const member = await requireApiUser(can.manageTeam);
  const id = parseId((await params).id);
  const target = await assertTeamMember(member.id, id);
  await query("DELETE FROM users WHERE id = $1", [id]);
  // One bidder or caller left: they take over every open job of their kind.
  await autoAssign(member.id);
  await audit(member.id, "team.removed", "user", id, { username: target.username });
  return NextResponse.json({ ok: true });
});
