import { NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { route } from "@/lib/http";
import { attachment, readUpload } from "@/lib/tailor/file-transfer";
import { replaceTemplatePdf, templatePdf, type TemplateKind } from "@/lib/tailor/templates";
import { templateFile } from "@/lib/tailor/style-store";

type Ctx = { params: Promise<{ kind: string }> };

function kindOf(value: string): TemplateKind {
  if (value === "resume" || value === "cover") return value;
  throw new HttpError(404, "Unknown template");
}

// GET: the current template PDF.
export const GET = route<Ctx>(async (_request, { params }) => {
  await requireApiUser(can.administer);
  const kind = kindOf((await params).kind);
  const bytes = await templatePdf(kind);
  if (!bytes) throw new HttpError(404, "No template uploaded");
  return attachment(bytes, templateFile(kind), "application/pdf");
});

// PUT (multipart "file" or application/pdf): replaces the template after reading its style.
export const PUT = route<Ctx>(async (request, { params }) => {
  const admin = await requireApiUser(can.administer);
  const kind = kindOf((await params).kind);
  const upload = await readUpload(request);
  if (!upload) throw new HttpError(400, "Send the PDF as a file upload.");
  let style;
  try {
    style = await replaceTemplatePdf(kind, upload.bytes);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Could not read the template.");
  }
  await audit(admin.id, "template.replaced", "template", kind, { file: upload.name });
  return NextResponse.json({ ok: true, file: templateFile(kind), style });
});
