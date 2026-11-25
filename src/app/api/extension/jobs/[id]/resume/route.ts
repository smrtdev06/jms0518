import { HttpError } from "@/lib/auth";
import { assertMemberJob, extensionRoute, requireExtensionMember } from "@/lib/extension";
import { parseId } from "@/lib/http";
import { sendPackageFile } from "@/lib/tailor/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = extensionRoute<Ctx>(async (request, { params }) => {
  const user = await requireExtensionMember(request);
  const jobId = parseId((await params).id);
  await assertMemberJob(user.id, jobId);
  const response = await sendPackageFile(jobId, "resume", user.id);
  if (!response) throw new HttpError(404, "That resume is not available");
  return response;
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
