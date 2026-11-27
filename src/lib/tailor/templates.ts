import { storage, templateKey } from "./storage";
import { loadStyle, styleFile, templateFile } from "./style-store";
import { analyzeTemplate, summarizeStyle } from "./template-style";

export type TemplateKind = "resume" | "cover";

// Replaces a template PDF after reading its style; the style is what generated PDFs are drawn from.
// A PDF whose style cannot be read is rejected and the old template stays. The style is saved last, so a
// reader that sees the new style also finds the new PDF.
export async function replaceTemplatePdf(kind: TemplateKind, bytes: Buffer) {
  if (bytes.length < 5 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Upload a PDF file.");
  const style = await analyzeTemplate(kind, bytes);
  await storage.put(templateKey(templateFile(kind)), bytes, "application/pdf");
  await storage.put(templateKey(styleFile(kind)), JSON.stringify(style, null, 2), "application/json");
  return summarizeStyle(style);
}

export async function templateInfo(kind: TemplateKind) {
  const key = templateKey(templateFile(kind));
  const [modified, style] = await Promise.all([storage.modified(key), kind === "resume" ? loadStyle("resume") : loadStyle("cover")]);
  return {
    kind,
    file: templateFile(kind),
    // 1 = the copy deployed in templates/, otherwise the upload time.
    uploadedAt: modified > 1 ? new Date(modified).toISOString() : null,
    summary: style ? summarizeStyle(style) : null,
  };
}

export async function templatePdf(kind: TemplateKind) {
  return storage.get(templateKey(templateFile(kind)));
}
