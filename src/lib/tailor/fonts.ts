import fs from "node:fs";
import path from "node:path";

// A font as a template uses it: the family name read from the PDF plus a generic fallback.
export type FontRef = { family: string; generic: "serif" | "sans-serif" | "monospace" };

// Font files for families that templates commonly use: regular, bold, italic, bold italic.
const FAMILY_FILES: Record<string, [string, string, string, string]> = {
  arial: ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"],
  calibri: ["calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"],
  cambria: ["cambria.ttc", "cambriab.ttf", "cambriai.ttf", "cambriaz.ttf"],
  georgia: ["georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf"],
  timesnewroman: ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"],
  verdana: ["verdana.ttf", "verdanab.ttf", "verdanai.ttf", "verdanaz.ttf"],
  tahoma: ["tahoma.ttf", "tahomabd.ttf", "tahoma.ttf", "tahomabd.ttf"],
  segoeui: ["segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"],
  garamond: ["gara.ttf", "garabd.ttf", "garait.ttf", "garabd.ttf"],
  trebuchetms: ["trebuc.ttf", "trebucbd.ttf", "trebucit.ttf", "trebucbi.ttf"],
  centurygothic: ["gothic.ttf", "gothicb.ttf", "gothici.ttf", "gothicbi.ttf"],
  bookantiqua: ["bkant.ttf", "antquab.ttf", "antquai.ttf", "antquabi.ttf"],
  palatinolinotype: ["pala.ttf", "palab.ttf", "palai.ttf", "palabi.ttf"],
  consolas: ["consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf"],
  couriernew: ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"],
  aptos: ["aptos.ttf", "aptos-bold.ttf", "aptos-italic.ttf", "aptos-bold-italic.ttf"],
};

// Free fonts shipped in fonts/ for machines without the Microsoft fonts (Linux servers such as Vercel).
// Each has the same letter widths as the family it stands in for, so lines break where the template's do:
// Carlito = Calibri, Caladea = Cambria, Arimo = Arial/Helvetica, Tinos = Times New Roman,
// Cousine = Courier New, Gelasio = Georgia. Other families use the closest of these.
const BUNDLED: Record<string, string> = {
  calibri: "carlito",
  cambria: "caladea",
  arial: "arimo",
  timesnewroman: "tinos",
  couriernew: "cousine",
  consolas: "cousine",
  georgia: "gelasio",
  verdana: "arimo",
  tahoma: "arimo",
  segoeui: "carlito",
  aptos: "carlito",
  trebuchetms: "arimo",
  centurygothic: "arimo",
  garamond: "tinos",
  bookantiqua: "tinos",
  palatinolinotype: "tinos",
};
const BUNDLED_FACES = ["regular", "bold", "italic", "bolditalic"];
const bundledDir = path.join(process.cwd(), "fonts");

// Families the PDF standard fonts already cover.
const STANDARD: Record<string, [string, string, string, string]> = {
  helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  timesroman: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};

const GENERIC: Record<FontRef["generic"], [string, string, string, string]> = {
  "sans-serif": STANDARD.helvetica,
  serif: STANDARD.times,
  monospace: STANDARD.courier,
};

let fontIndex: Map<string, string> | null = null;

function fontFiles() {
  if (fontIndex) return fontIndex;
  fontIndex = new Map();
  const dirs = [
    ...(process.env.FONT_DIRS || "").split(path.delimiter).filter(Boolean),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts") : "",
    "/usr/share/fonts/truetype/msttcorefonts",
    "/Library/Fonts",
  ].filter(Boolean);
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const key = name.toLowerCase();
        if (!fontIndex.has(key)) fontIndex.set(key, path.join(dir, name));
      }
    } catch {
      /* folder not present on this machine */
    }
  }
  return fontIndex;
}

function familyKey(family: string) {
  return family.toLowerCase().replace(/[^a-z]/g, "");
}

// Reads the family and weight from a PDF font name such as "BCDEEE+Calibri-Bold" or "Arial-BoldItalicMT".
export function parseFontName(raw: string) {
  const name = String(raw || "").replace(/^[A-Z]{6}\+/, "");
  const bold = /bold|black|heavy|semibold|demibold|demi\b/i.test(name);
  const italic = /italic|oblique|\bit\b/i.test(name);
  const family = name
    .split(/[-,]/)[0]
    .replace(/(PSMT|PS|MT)$/, "")
    .replace(/(Bold|Italic|Oblique|Regular)+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return { family: family || "Helvetica", bold, italic };
}

// The standard PDF fonts only cover Western European letters, so "Ștefan" or "Łukasz" would print as
// garbage. Their Unicode equivalents (same shapes and widths) are used whenever this machine has them.
const UNICODE_EQUIVALENT: Record<string, string> = {
  helvetica: "arial",
  arialmt: "arial",
  times: "timesnewroman",
  timesroman: "timesnewroman",
  courier: "couriernew",
};

// Resolves a template font to something PDFKit can draw: a font file on this machine or a standard PDF font.
export function resolveFont(font: FontRef, bold: boolean, italic: boolean): { key: string; file?: string } {
  const variant = (bold ? 1 : 0) + (italic ? 2 : 0);
  const named = familyKey(font.family);
  const generic = font.generic === "serif" ? "timesnewroman" : font.generic === "monospace" ? "couriernew" : "arial";
  const key = FAMILY_FILES[named] ? named : UNICODE_EQUIVALENT[named] || generic;
  const files = FAMILY_FILES[key];
  if (files) {
    // The family is used only when its regular face is available, so one document never mixes families.
    const regular = fontFiles().get(files[0]);
    if (regular && !regular.toLowerCase().endsWith(".ttc")) {
      const file = fontFiles().get(files[variant]) || regular;
      return { key: `${key}-${file === regular ? 0 : variant}`, file };
    }
  }
  // Not installed here: the bundled stand-in with the same letter widths.
  const standIn = BUNDLED[key] || BUNDLED[generic];
  if (standIn) {
    const file = path.join(bundledDir, `${standIn}-${BUNDLED_FACES[variant]}.ttf`);
    if (fs.existsSync(file)) return { key: `${standIn}-${variant}`, file };
  }
  // No font file at all: a standard PDF font (Western European letters only).
  const standard = STANDARD[named] || GENERIC[font.generic] || STANDARD.helvetica;
  return { key: standard[variant] };
}
