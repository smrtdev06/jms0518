import { NextResponse } from "next/server";
import { audit, transaction } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { assertJobAccess } from "@/lib/access";
import { parseId, route } from "@/lib/http";
import { appliedKey, getFile } from "@/lib/tailor/storage";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const GET = route<Ctx>(async (_request, { params }) => {
  const user = await requireApiUser();
  const jobId = parseId((await params).id);
  await assertJobAccess(user, jobId);
  const image = await getFile(appliedKey(jobId));
  if (!image) throw new HttpError(404, "No applied image");
  return new Response(new Uint8Array(image.data), {
    headers: { "Content-Type": image.content_type, "Cache-Control": "private, max-age=86400" },
  });
});

// Uploading the screenshot is what marks a "Ready to Apply" job as "Applied".
export const POST = route<Ctx>(async (request, { params }) => {
  const user = await requireApiUser(can.apply);
  const jobId = parseId((await params).id);
  await assertJobAccess(user, jobId);

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) throw new HttpError(400, "Attach the applied screenshot as 'image'");
  if (!ALLOWED.includes(file.type)) throw new HttpError(415, "Only PNG, JPEG, WEBP or GIF images are accepted");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Image must be 10 MB or smaller");
  const data = Buffer.from(await file.arrayBuffer());

  await transaction(async (db) => {
    const updated = await db.query(
      `UPDATE jobs SET apply_status = 'applied', applied_at = now(), applied_by = $2, updated_at = now()
       WHERE id = $1 AND apply_status = 'ready'`,
      [jobId, user.id],
    );
    if (!updated.rowCount) throw new HttpError(409, "This job has already been applied");
    await db.query(
      `INSERT INTO stored_files (key, data, content_type) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, updated_at = now()`,
      [appliedKey(jobId), data, file.type],
    );
  });
  await audit(user.id, "job.applied", "job", jobId, { size: data.length });
  return NextResponse.json({ ok: true });
});
