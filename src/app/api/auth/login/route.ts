import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { readJson, route, str } from "@/lib/http";
import { homePath } from "@/lib/roles";
import { verifySignIn } from "@/lib/sign-in";

export const POST = route(async (request) => {
  const body = await readJson(request);
  const result = await verifySignIn(request, str(body.username, 100), String(body.password ?? ""));
  if (!result.ok) throw new HttpError(result.status, result.error);
  const user = result.account;
  if (!user.is_active) throw new HttpError(403, "This account is deactivated");

  await createSession(user.id);
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  return NextResponse.json({ redirect: homePath(user.role) });
});
