import { can, requireApiUser, HttpError } from "@/lib/auth";
import { assertJobAccess } from "@/lib/access";
import { markAppliedWithImage, readStoredAppliedImage } from "@/lib/extension";
import { parseId, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const GET = route<Ctx>(async (_request, { params }) => {
  const user = await requireApiUser();
  const jobId = parseId((await params).id);
  await assertJobAccess(user, jobId);
  const image = await readStoredAppliedImage(jobId);
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
  await markAppliedWithImage(jobId, user.id, data, file.type, "app");
  return Response.json({ ok: true });
});
