import { audit } from "@/lib/db";
import { can, requireApiUser, HttpError } from "@/lib/auth";
import { route } from "@/lib/http";
import { attachment, json, readUpload } from "@/lib/tailor/http";
import { replaceTemplatePdf, templatePdf, type TemplateKind } from "@/lib/tailor/templates";
import { templateFile } from "@/lib/tailor/template-style";

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
  if (!upload) return json({ ok: false, error: "Send the PDF as a file upload." }, 400);
  try {
    const style = await replaceTemplatePdf(kind, upload.bytes);
    await audit(admin.id, "template.replaced", "template", kind, { file: upload.name });
    return json({ ok: true, file: templateFile(kind), style });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not read the template." }, 400);
  }
});
