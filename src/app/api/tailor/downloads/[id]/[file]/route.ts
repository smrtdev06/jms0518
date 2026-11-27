import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { parseId, route } from "@/lib/http";
import { sendPackageFile } from "@/lib/tailor/file-transfer";

type Ctx = { params: Promise<{ id: string; file: string }> };

// GET /api/tailor/downloads/:id/resume|cover|zip — built now from the saved content.
export const GET = route<Ctx>(async (_request, { params }) => {
  const user = await requireApiUser(can.tailor);
  const { id, file } = await params;
  if (file !== "resume" && file !== "cover" && file !== "zip") throw new HttpError(404, "Unknown file.");
  const response = await sendPackageFile(parseId(id), file, user.id);
  if (!response) throw new HttpError(404, "That package is not ready.");
  return response;
});
