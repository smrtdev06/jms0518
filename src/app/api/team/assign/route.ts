import { NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { assertTeamMember } from "@/lib/team";
import { setAssignments, type AssignKind } from "@/lib/assign";

// PUT { user_id, job_ids }: the member sets which open jobs a bidder (Ready to Apply) or caller (Scheduled)
// of their team works on. Jobs left out are unassigned from that person.
export const PUT = route(async (request) => {
  const member = await requireApiUser(can.manageTeam);
  const body = await readJson(request);
  const userId = Number(body.user_id);
  if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(400, "Choose a bidder or caller");
  if (!Array.isArray(body.job_ids) || body.job_ids.length > 5000) throw new HttpError(400, "job_ids must be a list");
  const jobIds = [...new Set(body.job_ids.map(Number))];
  if (jobIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new HttpError(400, "Invalid job id");

  const person = await assertTeamMember(member.id, userId);
  const kind = person.role as AssignKind;
  const result = await setAssignments(member.id, kind, userId, jobIds);
  await audit(member.id, "team.assigned", "user", userId, { kind, jobs: jobIds.length, ...result });
  return NextResponse.json({ ok: true, ...result });
});
