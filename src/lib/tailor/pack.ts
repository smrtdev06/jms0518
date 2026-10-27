import JSZip from "jszip";
import { query } from "@/lib/db";
import { coverFileName, resumeFileName, zipFileName } from "./filenames";
import { fitResumePdf, renderCoverPdf } from "./pdf";
import type { GeneratedContent, Profile } from "./types";

// What generation saves in jobs.tailored. The PDFs and the ZIP are built from it when they are
// downloaded, with the templates current at that time; nothing is rendered or stored in advance.
export type PackageSnapshot = {
  // The profile as it was when the content was written (with the tailored job titles).
  profile: Omit<Profile, "baseResumeText">;
  content: GeneratedContent;
  company: string;
  jobTitle: string;
  jobUrl: string;
};

export type FileKind = "resume" | "cover" | "zip";
type BuiltFile = { name: string; bytes: Buffer; type: string };

export function packageNames(snapshot: Pick<PackageSnapshot, "profile" | "company" | "jobTitle">) {
  return {
    resumeName: resumeFileName(snapshot.profile.fullName),
    coverName: coverFileName(snapshot.profile.fullName),
    zipName: zipFileName(snapshot.company, snapshot.jobTitle),
  };
}

async function resumePdf(snapshot: PackageSnapshot) {
  return (await fitResumePdf(snapshot.profile, snapshot.content)).pdf;
}

function coverPdf(snapshot: PackageSnapshot) {
  return renderCoverPdf(snapshot.profile, snapshot.content, snapshot.company, snapshot.jobTitle);
}

const jobUrlFile = (snapshot: PackageSnapshot) => `${snapshot.jobUrl.trim()}\n`;

// The resume, cover letter and job link, rendered together (for a ZIP).
export async function renderPackage(snapshot: PackageSnapshot) {
  const [resume, cover] = await Promise.all([resumePdf(snapshot), coverPdf(snapshot)]);
  return { ...packageNames(snapshot), resume, cover, jobUrl: jobUrlFile(snapshot) };
}

export async function buildFile(snapshot: PackageSnapshot, kind: FileKind): Promise<BuiltFile> {
  const names = packageNames(snapshot);
  if (kind === "resume") return { name: names.resumeName, bytes: await resumePdf(snapshot), type: "application/pdf" };
  if (kind === "cover") return { name: names.coverName, bytes: await coverPdf(snapshot), type: "application/pdf" };
  const built = await renderPackage(snapshot);
  const zip = new JSZip();
  zip.file(built.resumeName, built.resume);
  zip.file(built.coverName, built.cover);
  zip.file("job-url.txt", built.jobUrl);
  return { name: names.zipName, bytes: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), type: "application/zip" };
}

// The saved content of a generated job, or null when the job has none.
export async function loadSnapshot(jobId: number, userPk?: number) {
  const rows = await query<{ tailored: PackageSnapshot | null }>(
    `SELECT tailored FROM jobs WHERE id = $1 AND gen_status = 'done' ${userPk === undefined ? "" : "AND user_id = $2"}`,
    userPk === undefined ? [jobId] : [jobId, userPk],
  );
  return rows[0]?.tailored ?? null;
}
