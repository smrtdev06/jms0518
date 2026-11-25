import { NextResponse } from "next/server";
import { workProfile, type ProfileSummary } from "./access";
import { createExtensionToken, HttpError, userFromExtensionToken, type SessionUser } from "./auth";
import { audit, query, queryOne, transaction } from "./db";
import { countJobs } from "./jobs";
import { readJson } from "./http";
import { appliedKey, getFile } from "./tailor/storage";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type Handler<C> = (request: Request, context: C) => Promise<Response>;

export function extensionJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

function withExtensionCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Preflight response for the extension routes. */
export function extensionOptions() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** JSON errors, and CORS so a browser extension can read them. */
export function extensionRoute<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    if (request.method === "OPTIONS") return extensionOptions();
    try {
      return withExtensionCors(await handler(request, context));
    } catch (error) {
      if (error instanceof HttpError) return extensionJson({ ok: false, error: error.message }, error.status);
      console.error(error);
      return extensionJson({ ok: false, error: "Internal server error" }, 500);
    }
  };
}

export async function requireExtensionMember(request: Request): Promise<SessionUser> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) throw new HttpError(401, "Sign in from the extension first");
  const user = await userFromExtensionToken(token);
  if (!user) throw new HttpError(401, "Sign in from the extension first");
  if (user.role !== "member") throw new HttpError(403, "Only a member can use the auto-apply extension");
  return user;
}

type ExtensionUser = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
};

export function presentUser(user: { id: number; username: string; displayName: string; role: string; active: boolean }): ExtensionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
  };
}

export async function issueMemberToken(userId: number) {
  return createExtensionToken(userId);
}

function presentProfile(profile: ProfileSummary | null) {
  if (!profile) return null;
  const headline = [profile.title, profile.company].filter(Boolean).join(" at ");
  const education = [profile.degree, profile.school].filter(Boolean).join(", ");
  return {
    id: profile.id,
    name: profile.name,
    label: profile.label,
    title: profile.title,
    company: profile.company,
    headline,
    degree: profile.degree,
    school: profile.school,
    education,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    linkedin: profile.linkedin,
  };
}

async function memberProfile(user: SessionUser) {
  const profile = presentProfile(await workProfile(user));
  const counts = await countJobs(user.id);
  return {
    profile,
    counts: { toApply: counts.ready, applied: counts.applied, failed: counts.failed },
  };
}

type ExtensionJobRow = {
  id: number;
  company_name: string;
  job_title: string;
  job_link: string;
  apply_status: "ready" | "applied" | "failed";
  applied_at: Date | string | null;
  apply_fail_reason: string;
  apply_failed_at: Date | string | null;
  generated_at: Date | string | null;
  updated_at: Date | string | null;
  has_resume: boolean;
  has_cover_letter: boolean;
  has_image: boolean;
  bidder_name: string | null;
};

function iso(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function roleLabel(company: string, title: string) {
  if (company && title) return `${company} – ${title}`;
  return title || company || "Untitled job";
}

export function presentJob(row: ExtensionJobRow) {
  return {
    id: row.id,
    role: roleLabel(row.company_name, row.job_title),
    company: row.company_name,
    title: row.job_title,
    link: row.job_link,
    applyStatus: row.apply_status,
    appliedAt: iso(row.applied_at),
    failedAt: iso(row.apply_failed_at),
    failReason: row.apply_fail_reason,
    generatedAt: iso(row.generated_at),
    updatedAt: iso(row.updated_at),
    bidder: row.bidder_name,
    hasResume: row.has_resume,
    hasCoverLetter: row.has_cover_letter,
    appliedImage: { submitted: row.has_image, status: row.has_image ? "submitted" : "none" },
    resumeUrl: `/api/extension/jobs/${row.id}/resume`,
    coverLetterUrl: `/api/extension/jobs/${row.id}/cover-letter`,
  };
}

function dayBound(value: string | null, end: boolean) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Dates must be YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Dates must be YYYY-MM-DD");
  if (end) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

async function listExtensionJobs(
  userId: number,
  filters: { status?: string | null; q?: string | null; appliedFrom?: string | null; appliedTo?: string | null; limit?: number },
) {
  const status = filters.status && filters.status !== "all" ? filters.status : "";
  if (status && status !== "ready" && status !== "applied" && status !== "failed") {
    throw new HttpError(400, "status must be all, ready, applied or failed");
  }
  const limit = Math.min(1000, Math.max(1, filters.limit || 500));
  const where = ["j.user_id = $1", "j.gen_status = 'done'"];
  const params: unknown[] = [userId];
  if (status) {
    params.push(status);
    where.push(`j.apply_status = $${params.length}`);
  }
  const q = (filters.q ?? "").trim().slice(0, 200);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(j.company_name ILIKE $${params.length} OR j.job_title ILIKE $${params.length} OR j.job_link ILIKE $${params.length})`);
  }
  const from = dayBound(filters.appliedFrom ?? null, false);
  const to = dayBound(filters.appliedTo ?? null, true);
  const stepAt = "COALESCE(j.applied_at, j.apply_failed_at, j.generated_at)";
  if (from) {
    params.push(from);
    where.push(`${stepAt} >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`${stepAt} < $${params.length}`);
  }
  const whereSql = where.join(" AND ");
  const [{ total }] = await query<{ total: number }>(`SELECT count(*)::int AS total FROM jobs j WHERE ${whereSql}`, params);
  const rows = await query<ExtensionJobRow>(
    `SELECT j.id, j.company_name, j.job_title, j.job_link, j.apply_status, j.applied_at, j.apply_fail_reason,
       j.apply_failed_at, j.generated_at, j.updated_at,
       (j.resume_name <> '') AS has_resume, (j.cover_name <> '') AS has_cover_letter,
       EXISTS (SELECT 1 FROM stored_files f WHERE f.key = 'applied/' || j.id) AS has_image,
       (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = j.assigned_bidder_id) AS bidder_name
     FROM jobs j WHERE ${whereSql}
     ORDER BY array_position(ARRAY['ready', 'applied', 'failed'], j.apply_status),
       CASE WHEN j.apply_status = 'ready' THEN j.generated_at END DESC,
       j.applied_at DESC NULLS LAST, j.apply_failed_at DESC NULLS LAST, j.id DESC
     LIMIT ${limit}`,
    params,
  );
  return { jobs: rows.map(presentJob), total, truncated: total > rows.length };
}

export async function extensionSnapshot(user: SessionUser) {
  const [{ profile, counts }, listed] = await Promise.all([
    memberProfile(user),
    listExtensionJobs(user.id, { limit: 1000 }),
  ]);
  return {
    ok: true,
    syncedAt: new Date().toISOString(),
    user: presentUser({ ...user, active: true }),
    profile,
    counts,
    jobs: listed.jobs,
    total: listed.total,
    truncated: listed.truncated,
  };
}

export async function assertMemberJob(userId: number, jobId: number) {
  const job = await queryOne<{ id: number; apply_status: "ready" | "applied" | "failed" }>(
    "SELECT id, apply_status FROM jobs WHERE id = $1 AND user_id = $2 AND gen_status = 'done'",
    [jobId, userId],
  );
  if (!job) throw new HttpError(404, "Job not found");
  return job;
}

export async function readAppliedImage(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await readJson<{ image?: unknown; contentType?: unknown; content_type?: unknown }>(request);
    const type = String(body.contentType ?? body.content_type ?? "").trim().toLowerCase();
    const raw = typeof body.image === "string" ? body.image.trim() : "";
    if (!IMAGE_TYPES.includes(type)) throw new HttpError(415, "Only PNG, JPEG, WEBP or GIF images are accepted");
    const data = Buffer.from(raw.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!data.length) throw new HttpError(400, "Image data is empty");
    if (data.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Image must be 10 MB or smaller");
    return { data, type };
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) throw new HttpError(400, "Attach the applied screenshot as 'image'");
  if (!IMAGE_TYPES.includes(file.type)) throw new HttpError(415, "Only PNG, JPEG, WEBP or GIF images are accepted");
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image must be 10 MB or smaller");
  return { data: Buffer.from(await file.arrayBuffer()), type: file.type };
}

/** Uploading the screenshot is what marks a Ready to Apply job as Applied. */
export async function markAppliedWithImage(jobId: number, userId: number, data: Buffer, contentType: string, source: string) {
  await transaction(async (db) => {
    const updated = await db.query(
      `UPDATE jobs SET apply_status = 'applied', applied_at = now(), applied_by = $2, updated_at = now()
       WHERE id = $1 AND apply_status = 'ready'`,
      [jobId, userId],
    );
    if (!updated.rowCount) throw new HttpError(409, "This job has already been applied");
    await db.query(
      `INSERT INTO stored_files (key, data, content_type) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, updated_at = now()`,
      [appliedKey(jobId), data, contentType],
    );
  });
  await audit(userId, "job.applied", "job", jobId, { size: data.length, source });
}

export async function readStoredAppliedImage(jobId: number) {
  return getFile(appliedKey(jobId));
}
