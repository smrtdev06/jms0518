import { requireApiUser, HttpError } from "@/lib/auth";
import { assertJobAccess } from "@/lib/access";
import { parseId, route } from "@/lib/http";
import { sendPackageFile } from "@/lib/tailor/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/jobs/:id/document?type=resume|cover_letter|zip — built now from the content the Resume Tailor saved.
export const GET = route<Ctx>(async (request, { params }) => {
  const user = await requireApiUser();
  const jobId = parseId((await params).id);
  await assertJobAccess(user, jobId);
  const type = new URL(request.url).searchParams.get("type");
  const response = await sendPackageFile(jobId, type === "cover_letter" ? "cover" : type === "zip" ? "zip" : "resume");
  if (!response) throw new HttpError(404, "That file is not available");
  return response;
});
