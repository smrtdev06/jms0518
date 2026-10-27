import { can, requireApiUser } from "@/lib/auth";
import { parseId, route } from "@/lib/http";
import { json, sendPackageFile } from "@/lib/tailor/http";

type Ctx = { params: Promise<{ id: string; file: string }> };

// GET /api/tailor/downloads/:id/resume|cover|zip — built now from the saved content.
export const GET = route<Ctx>(async (_request, { params }) => {
  const user = await requireApiUser(can.tailor);
  const { id, file } = await params;
  if (file !== "resume" && file !== "cover" && file !== "zip") return json({ ok: false, error: "Unknown file." }, 404);
  const response = await sendPackageFile(parseId(id), file, user.id);
  return response ?? json({ ok: false, error: "That package is not ready." }, 404);
});
