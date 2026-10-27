import { can, requireApiUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { COMBINED_NAME, combinedFile } from "@/lib/tailor/combined";
import { attachment, json } from "@/lib/tailor/http";
import { withUserLock } from "@/lib/tailor/user-lock";

// One All-Packages.zip with a folder for every finished package on the board.
export const GET = route(async () => {
  const user = await requireApiUser(can.tailor);
  // Runs after any Clear or new batch in progress, so the ZIP is never rebuilt from files being deleted.
  const bytes = await withUserLock(user.id, () => combinedFile(user.id));
  if (!bytes) return json({ ok: false, error: "No finished packages to download yet." }, 404);
  return attachment(bytes, COMBINED_NAME, "application/zip");
});
