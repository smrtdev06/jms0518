import JSZip from "jszip";
import { query } from "@/lib/db";
import { renderPackage, type PackageSnapshot } from "./pack";

// One ZIP holding a folder for every finished package on the user's board (resume, cover letter,
// job-url.txt). Built when it is downloaded, from the content saved in the jobs table.
export const COMBINED_NAME = "All-Packages.zip";

export async function combinedFile(userPk: number) {
  const rows = await query<{ board_position: number; zip_name: string; tailored: PackageSnapshot | null }>(
    `SELECT board_position, zip_name, tailored FROM jobs
     WHERE user_id = $1 AND on_board AND gen_status = 'done' AND tailored IS NOT NULL
     ORDER BY board_position`,
    [userPk],
  );
  if (!rows.length) return null;
  const zip = new JSZip();
  const folders = new Set<string>();
  for (const row of rows) {
    const built = await renderPackage(row.tailored!);
    const folder = uniqueFolder(row.zip_name.replace(/\.zip$/i, "") || `Package ${row.board_position}`, folders);
    zip.file(`${folder}/${built.resumeName}`, built.resume);
    zip.file(`${folder}/${built.coverName}`, built.cover);
    zip.file(`${folder}/job-url.txt`, built.jobUrl);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function uniqueFolder(name: string, used: Set<string>) {
  let folder = name;
  for (let count = 2; used.has(folder.toLowerCase()); count += 1) folder = `${name} (${count})`;
  used.add(folder.toLowerCase());
  return folder;
}
