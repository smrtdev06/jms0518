import { extensionJson, extensionRoute, assertMemberJob, markAppliedWithImage, readAppliedImage, readStoredAppliedImage, requireExtensionMember } from "@/lib/extension";
import { HttpError } from "@/lib/auth";
import { parseId } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = extensionRoute<Ctx>(async (request, { params }) => {
  const user = await requireExtensionMember(request);
  const jobId = parseId((await params).id);
  await assertMemberJob(user.id, jobId);
  const image = await readStoredAppliedImage(jobId);
  if (!image) throw new HttpError(404, "No applied image");
  return new Response(new Uint8Array(image.data), {
    headers: { "Content-Type": image.content_type, "Cache-Control": "private, max-age=86400" },
  });
});

// POST multipart field "image", or JSON { image: "<base64>", contentType: "image/png" }.
// This is what marks a Ready to Apply job as Applied.
export const POST = extensionRoute<Ctx>(async (request, { params }) => {
  const user = await requireExtensionMember(request);
  const jobId = parseId((await params).id);
  await assertMemberJob(user.id, jobId);
  const image = await readAppliedImage(request);
  await markAppliedWithImage(jobId, user.id, image.data, image.type, "extension");
  return extensionJson({ ok: true, applyStatus: "applied", appliedImage: { submitted: true, status: "submitted" } });
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
