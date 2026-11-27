import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { googleConfigured } from "@/lib/gmail/google";
import { syncGmail } from "@/lib/gmail/sync";

// The daily Gmail check, called by Vercel Cron (vercel.json: once every 24 hours). Vercel sends
// "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set in the project's environment variables; without it
// this endpoint refuses every call, so nobody else can start a check.
// A long-running server (npm run dev / start:all) runs the same check on its own (src/instrumentation.ts).

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) return NextResponse.json({ ok: false, error: "Set CRON_SECRET to allow the scheduled Gmail check." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!googleConfigured()) return NextResponse.json({ ok: true, skipped: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set" });
  try {
    // Stop well before the host's limit; an inbox not finished is continued by the next check.
    const result = await syncGmail({ deadline: Date.now() + (maxDuration - 30) * 1000, trigger: "cron" });
    console.log("[jms] Gmail check:", JSON.stringify(result.accounts.map(({ email, status, checked, requests, matched, left, failed }) => ({ email, status, checked, requests, matched, left, failed }))));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[jms] Gmail check failed:", error);
    return NextResponse.json({ ok: false, error: "The Gmail check failed; see the server log." }, { status: 500 });
  }
}
