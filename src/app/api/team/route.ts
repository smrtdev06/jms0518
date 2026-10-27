import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { audit, queryOne } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { validateUserBody } from "@/lib/validators";
import { autoAssign } from "@/lib/assign";

// A member adds a bidder or caller to their own team.
export const POST = route(async (request) => {
  const member = await requireApiUser(can.manageTeam);
  const body = await readJson(request);
  const input = validateUserBody({ ...body, member_id: member.id }, true, ["bidder", "caller"]);
  const exists = await queryOne("SELECT 1 FROM users WHERE lower(username) = lower($1)", [input.username]);
  if (exists) throw new HttpError(409, "That user ID is already taken");
  const row = await queryOne<{ id: number }>(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, member_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.username, await bcrypt.hash(input.password, 10), input.displayName, input.role, input.isActive, member.id],
  );
  await autoAssign(member.id);
  await audit(member.id, "team.added", "user", row!.id, { username: input.username, role: input.role });
  return NextResponse.json({ id: row!.id }, { status: 201 });
});
