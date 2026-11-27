import { parseFontName, type FontRef } from "./fonts";

// Reads the text runs (position, font, size, colour) and drawn rules of a PDF with pdf.js, for template-style.ts.
// Positions are PDF points measured from the top of the page.

export type Run = { page: number; x: number; x1: number; base: number; size: number; font: FontRef; bold: boolean; italic: boolean; color: string; text: string };
export type Line = { page: number; base: number; x0: number; x1: number; size: number; runs: Run[]; text: string };
export type Rule = { page: number; y: number; x0: number; x1: number; thickness: number; color: string };
export type Parsed = { width: number; height: number; pages: number; lines: Line[]; rules: Rule[] };

export async function parsePdf(bytes: Buffer): Promise<Parsed> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const OPS = pdfjs.OPS;
  const runs: Run[] = [];
  const rules: Rule[] = [];
  let width = 612;
  let height = 792;
  const pageCount = Math.min(doc.numPages, 4);
  for (let p = 1; p <= pageCount; p += 1) {
    const page = await doc.getPage(p);
    const [vx0, vy0, vx1, vy1] = page.view;
    if (p === 1) {
      width = vx1 - vx0;
      height = vy1 - vy0;
    }
    const pageHeight = vy1 - vy0;
    const ops = await page.getOperatorList();

    // Walk the drawing operations: fill colors for text, and thin horizontal lines or bars used as rules.
    const shows: { font: string; color: string; text: string }[] = [];
    // Coordinates start at the page box's corner, which is not always 0,0 (cropped pages).
    let ctm = [1, 0, 0, 1, -vx0, -vy0];
    const stack: { ctm: number[]; fill: string; stroke: string; lineWidth: number }[] = [];
    let fill = "#000000";
    let stroke = "#000000";
    let lineWidth = 1;
    let font = "";
    let path: { ops: number[]; coords: number[]; ctm: number[] } | null = null;
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push({ ctm, fill, stroke, lineWidth });
      else if (fn === OPS.restore) {
        const state = stack.pop();
        if (state) ({ ctm, fill, stroke, lineWidth } = state);
      } else if (fn === OPS.transform) ctm = multiply(args as number[], ctm);
      else if (fn === OPS.setFillRGBColor) fill = hexColor(args);
      else if (fn === OPS.setStrokeRGBColor) stroke = hexColor(args);
      else if (fn === OPS.setLineWidth) lineWidth = Number(args[0]) || 1;
      else if (fn === OPS.setFont) font = String(args[0]);
      else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        const glyphs = (args[0] || []) as unknown[];
        const text = glyphs.map((glyph) => (glyph && typeof glyph === "object" ? String((glyph as { unicode?: string }).unicode ?? "") : typeof glyph === "number" && glyph < -200 ? " " : "")).join("");
        shows.push({ font, color: fill, text });
      } else if (fn === OPS.constructPath) {
        path = { ops: Array.from(args[0] as number[]), coords: Array.from(args[1] as number[]), ctm };
      } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
        if (path) rules.push(...strokeRules(path, OPS, p, width, pageHeight, stroke, lineWidth));
        path = null;
      } else if (fn === OPS.fill || fn === OPS.eoFill) {
        if (path) rules.push(...fillRules(path, OPS, p, width, pageHeight, fill));
        path = null;
      } else if (fn === OPS.endPath) path = null;
    }

    const content = await page.getTextContent();
    let pointer = 0;
    for (const raw of content.items) {
      const item = raw as { str?: string; transform?: number[]; width?: number; fontName?: string };
      const text = String(item.str || "");
      if (!text.trim() || !item.transform) continue;
      const size = Math.hypot(item.transform[2], item.transform[3]) || Math.hypot(item.transform[0], item.transform[1]);
      // Match the text item to the drawing operations that showed it, to learn its color. Items and
      // operations are split differently by different PDF makers, so the color covering most letters wins.
      let color = shows[Math.min(pointer, shows.length - 1)]?.color || "#000000";
      const key = text.replace(/\s+/g, "");
      for (let j = pointer; j < Math.min(shows.length, pointer + 40); j += 1) {
        const opKey = shows[j].text.replace(/\s+/g, "");
        if (!opKey || !(key.includes(opKey) || opKey.includes(key.slice(0, Math.min(8, key.length))))) continue;
        const letters = new Map<string, number>();
        let covered = 0;
        let k = j;
        while (k < shows.length && covered < key.length) {
          const part = shows[k].text.replace(/\s+/g, "");
          if (!part) {
            k += 1;
            continue;
          }
          if (k > j && !key.includes(part)) break;
          const counted = part.replace(/[|·•\-–—,.:;]/g, "").length;
          letters.set(shows[k].color, (letters.get(shows[k].color) || 0) + counted);
          covered += part.length;
          k += 1;
        }
        color = [...letters.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || shows[j].color;
        pointer = covered >= key.length && shows[k - 1]?.text.replace(/\s+/g, "").length <= key.length ? k : k - 1;
        break;
      }
      let fontName = "";
      try {
        fontName = String((page.commonObjs.get(String(item.fontName)) as { name?: string })?.name || "");
      } catch {
        fontName = "";
      }
      const styleFamily = String((content.styles as Record<string, { fontFamily?: string }>)[String(item.fontName)]?.fontFamily || "");
      const parsedFont = parseFontName(fontName);
      runs.push({
        page: p,
        x: item.transform[4] - vx0,
        x1: item.transform[4] - vx0 + Number(item.width || 0),
        base: pageHeight - (item.transform[5] - vy0),
        size: round(size),
        font: { family: parsedFont.family, generic: genericFamily(styleFamily, parsedFont.family) },
        bold: parsedFont.bold,
        italic: parsedFont.italic,
        color,
        text,
      });
    }
  }
  return { width: round(width), height: round(height), pages: pageCount, lines: groupLines(runs), rules };
}

export function strokeRules(path: { ops: number[]; coords: number[]; ctm: number[] }, OPS: Record<string, number>, page: number, width: number, height: number, color: string, lineWidth: number) {
  const found: Rule[] = [];
  let c = 0;
  let last: [number, number] | null = null;
  for (const op of path.ops) {
    if (op === OPS.moveTo) {
      last = apply(path.ctm, path.coords[c], path.coords[c + 1]);
      c += 2;
    } else if (op === OPS.lineTo) {
      const next = apply(path.ctm, path.coords[c], path.coords[c + 1]);
      c += 2;
      if (last && Math.abs(next[1] - last[1]) < 0.6 && Math.abs(next[0] - last[0]) > width * 0.3) {
        const scale = Math.hypot(path.ctm[2], path.ctm[3]) || 1;
        found.push({ page, y: height - last[1], x0: Math.min(last[0], next[0]), x1: Math.max(last[0], next[0]), thickness: round(lineWidth * scale), color });
      }
      last = next;
    } else if (op === OPS.rectangle) c += 4;
    else if (op === OPS.curveTo) c += 6;
    else if (op === OPS.curveTo2 || op === OPS.curveTo3) c += 4;
  }
  return found;
}

export function fillRules(path: { ops: number[]; coords: number[]; ctm: number[] }, OPS: Record<string, number>, page: number, width: number, height: number, color: string) {
  const found: Rule[] = [];
  let c = 0;
  for (const op of path.ops) {
    if (op === OPS.rectangle) {
      const [x, y, w, h] = path.coords.slice(c, c + 4);
      c += 4;
      const a = apply(path.ctm, x, y);
      const b = apply(path.ctm, x + w, y + h);
      const thickness = Math.abs(b[1] - a[1]);
      if (thickness > 0.2 && thickness <= 4 && Math.abs(b[0] - a[0]) > width * 0.3) {
        found.push({ page, y: height - (a[1] + b[1]) / 2, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), thickness: round(thickness), color });
      }
    } else if (op === OPS.moveTo || op === OPS.lineTo) c += 2;
    else if (op === OPS.curveTo) c += 6;
    else if (op === OPS.curveTo2 || op === OPS.curveTo3) c += 4;
  }
  return found;
}

export function groupLines(runs: Run[]): Line[] {
  const sorted = [...runs].sort((a, b) => a.page - b.page || a.base - b.base || a.x - b.x);
  const lines: Line[] = [];
  for (const run of sorted) {
    const line = lines.find((item) => item.page === run.page && Math.abs(item.base - run.base) <= Math.max(1.2, run.size * 0.25));
    if (line) line.runs.push(run);
    else lines.push({ page: run.page, base: run.base, x0: 0, x1: 0, size: 0, runs: [run], text: "" });
  }
  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
    line.x0 = line.runs[0].x;
    line.x1 = Math.max(...line.runs.map((run) => run.x1));
    line.size = Math.max(...line.runs.map((run) => run.size));
    line.base = round(line.runs[0].base);
    let text = "";
    let previous: Run | null = null;
    for (const run of line.runs) {
      if (previous && run.x - previous.x1 > run.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(run.text)) text += " ";
      text += run.text;
      previous = run;
    }
    line.text = text.replace(/\s+/g, " ").trim();
  }
  return lines.sort((a, b) => a.page - b.page || a.base - b.base);
}

// ---------- Helpers ----------

export function genericFamily(styleFamily: string, family: string): FontRef["generic"] {
  if (/mono|courier|consol/i.test(styleFamily + family)) return "monospace";
  if (/(^|[^-])serif/i.test(styleFamily) && !/sans/i.test(styleFamily)) return "serif";
  if (/times|georgia|garamond|cambria|palatino|antiqua|book|serif/i.test(family) && !/sans/i.test(family)) return "serif";
  return "sans-serif";
}

export function hexColor(args: unknown[]) {
  const value = args && typeof args === "object" && 0 in (args as object) ? (args as unknown as ArrayLike<number> | string[]) : [0, 0, 0];
  if (typeof value[0] === "string" && String(value[0]).startsWith("#")) return String(value[0]);
  const [r, g, b] = [0, 1, 2].map((index) => Math.max(0, Math.min(255, Math.round(Number((value as ArrayLike<number>)[index]) || 0))));
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

export function multiply(m: number[], n: number[]) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function apply(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function round(value: number) {
  return Math.round(value * 100) / 100;
}
