import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { route } from "@/lib/http";
import { COMBINED_NAME, combinedFile } from "@/lib/tailor/combined";
import { attachment } from "@/lib/tailor/file-transfer";
import { withUserLock } from "@/lib/tailor/user-lock";

// One All-Packages.zip with a folder for every finished package on the board.
export const GET = route(async () => {
  const user = await requireApiUser(can.tailor);
  // Runs after any Clear or new batch in progress, so the ZIP is never rebuilt from files being deleted.
  const bytes = await withUserLock(user.id, () => combinedFile(user.id));
  if (!bytes) throw new HttpError(404, "No finished packages to download yet.");
  return attachment(bytes, COMBINED_NAME, "application/zip");
});
