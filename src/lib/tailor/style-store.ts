import { storage, templateKey } from "./storage";
import { type CoverStyle, type ResumeStyle, STYLE_VERSION, analyzeTemplate } from "./template-style";

// The template styles generated PDFs are drawn with: the stored style JSON, or the template PDF read again
// (template-style.ts) when it is newer. Read styles are cached per template version.

export function templateFile(kind: "resume" | "cover") {
  return kind === "resume" ? "Resume-Template.pdf" : "Coverletter-Template.pdf";
}

export function styleFile(kind: "resume" | "cover") {
  return templateFile(kind).replace(/.pdf$/i, ".style.json");
}

export const cache = new Map<string, { key: string; style: ResumeStyle | CoverStyle | null }>();

// The style for generated PDFs: from the stored style, or read from the template PDF if that is newer.
export async function loadStyle(kind: "resume"): Promise<ResumeStyle | null>;
export async function loadStyle(kind: "cover"): Promise<CoverStyle | null>;
export async function loadStyle(kind: "resume" | "cover") {
  const pdfKey = templateKey(templateFile(kind));
  const jsonKey = templateKey(styleFile(kind));
  const [pdfTime, jsonTime] = await Promise.all([storage.modified(pdfKey), storage.modified(jsonKey)]);
  if (!pdfTime && !jsonTime) return null;
  const key = `${kind}:${pdfTime}:${jsonTime}`;
  const hit = cache.get(kind);
  if (hit && hit.key === key) return hit.style;
  // Several packages render at once; they share one read of the template instead of each analyzing it.
  const pending = loading.get(key);
  if (pending) return pending;
  const work = readStyle(kind, pdfKey, jsonKey, pdfTime, jsonTime).then((style) => {
    cache.set(kind, { key, style });
    return style;
  });
  loading.set(key, work);
  return work.finally(() => loading.delete(key));
}

export const loading = new Map<string, Promise<ResumeStyle | CoverStyle | null>>();

export async function readStyle(kind: "resume" | "cover", pdfKey: string, jsonKey: string, pdfTime: number, jsonTime: number) {
  const stored = async () => {
    const bytes = await storage.get(jsonKey);
    if (!bytes) throw new Error(`${jsonKey} is missing.`);
    return JSON.parse(bytes.toString("utf8")) as ResumeStyle | CoverStyle;
  };
  if (jsonTime && jsonTime >= pdfTime) {
    try {
      const style = await stored();
      // A resume style saved by an older reader misses newer details, so it is read from the PDF again.
      if (style.kind !== "resume" || (style.version || 0) >= STYLE_VERSION || !pdfTime) return style;
    } catch (error) {
      console.warn(`${jsonKey} could not be read; reading the template PDF again.`, error);
    }
  }
  if (!pdfTime) return null;
  try {
    const pdf = await storage.get(pdfKey);
    if (!pdf) throw new Error(`${pdfKey} is missing.`);
    const style = await analyzeTemplate(kind, pdf);
    await storage.put(jsonKey, JSON.stringify(style, null, 2));
    return style;
  } catch (error) {
    console.warn(`The ${kind} template could not be read; generated PDFs use the previous or default style.`, error);
    return jsonTime ? stored().catch(() => null) : null;
  }
}
