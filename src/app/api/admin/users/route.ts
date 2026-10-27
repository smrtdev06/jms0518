import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { audit, queryOne } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { validateUserBody } from "@/lib/validators";
import { autoAssign } from "@/lib/assign";
import { assertMember } from "@/lib/team";

export const POST = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  const input = validateUserBody(await readJson(request), true);
  await assertMember(input.memberId);
  const exists = await queryOne("SELECT 1 FROM users WHERE lower(username) = lower($1)", [input.username]);
  if (exists) throw new HttpError(409, "That user ID is already taken");
  const row = await queryOne<{ id: number }>(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, member_id, profile_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.username, await bcrypt.hash(input.password, 10), input.displayName, input.role, input.isActive, input.memberId, input.profileLabel],
  );
  await autoAssign(input.memberId);
  await audit(admin.id, "user.created", "user", row!.id, { username: input.username, role: input.role, memberId: input.memberId });
  return NextResponse.json({ id: row!.id }, { status: 201 });
});
