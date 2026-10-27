import { NextResponse } from "next/server";
import { audit, transaction } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { readJson, route } from "@/lib/http";

export const PUT = route(async (request) => {
  const admin = await requireApiUser(can.administer);
  const body = await readJson(request);
  const cooldown = Number(body.company_cooldown_days);
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 365) throw new HttpError(400, "Cooldown must be 0–365 days");
  const scope = body.duplicate_scope === "global" ? "global" : "profile";

  const values = { company_cooldown_days: cooldown, duplicate_scope: scope };
  await transaction(async (db) => {
    for (const [key, value] of Object.entries(values)) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, JSON.stringify(value)],
      );
    }
  });
  await audit(admin.id, "settings.updated", "settings", null, values);
  return NextResponse.json({ ok: true });
});
