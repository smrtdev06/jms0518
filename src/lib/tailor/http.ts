import { NextResponse } from "next/server";
import { buildFile, loadSnapshot, type FileKind } from "./pack";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

// A server error for the response, with the details only in the server log.
export function serverError(error: unknown, message: string) {
  console.error(message, error);
  return json({ ok: false, error: message }, 500);
}

export function attachment(body: Buffer | string, filename: string, type: string) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const payload = typeof body === "string" ? body : new Uint8Array(body);
  return new NextResponse(payload, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function readUpload(request: Request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return null;
    return { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
  }
  if (type.includes("application/pdf")) {
    return { name: "upload.pdf", bytes: Buffer.from(await request.arrayBuffer()) };
  }
  return null;
}

// Builds one file of a generated package (resume, cover letter or ZIP) from its saved content.
export async function sendPackageFile(jobId: number, kind: FileKind, userPk?: number) {
  const snapshot = await loadSnapshot(jobId, userPk);
  if (!snapshot) return null;
  const file = await buildFile(snapshot, kind);
  return attachment(file.bytes, file.name, file.type);
}
