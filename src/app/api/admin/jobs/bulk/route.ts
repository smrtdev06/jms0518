import { NextResponse } from "next/server";
import { audit, query } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { removeJobFiles } from "@/lib/tailor/storage";

// { action: "delete", ids: number[] } — jobs still being generated are left alone.
export const POST = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  const body = await readJson(request);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!ids.length) throw new HttpError(400, "Select at least one job");
  if (body.action !== "delete") throw new HttpError(400, "Unknown action");
  const rows = await query<{ id: number }>(
    "DELETE FROM jobs WHERE id = ANY($1::int[]) AND gen_status NOT IN ('running', 'queued') RETURNING id",
    [ids],
  );
  await removeJobFiles(rows.map((r) => r.id));
  await audit(admin.id, "job.bulk_deleted", "job", null, { ids: rows.map((r) => r.id) });
  return NextResponse.json({ deleted: rows.length });
});
