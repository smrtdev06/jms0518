import PDFDocument from "pdfkit";
import { DEFAULT_COVER_STYLE, DEFAULT_RESUME_STYLE } from "./default-styles";
import { resolveFont } from "./fonts";
import { loadStyle, type Align, type PageStyle, type RuleStyle, type TextStyle } from "./template-style";
import type { Bullet, GeneratedContent, Profile } from "./types";

// Generated PDFs are drawn in the style read from the uploaded templates (see template-style.ts):
// the same page size, margins, fonts, sizes, colors, rules, bullets and line spacing.

type Doc = InstanceType<typeof PDFDocument>;
type Segment = { text: string; style: TextStyle };

// Fonts such as Calibri join letter pairs ("ti", "fl") into one glyph. That looks the same but makes
// copied text and ATS parsers read "positon" instead of "position", so those joins are turned off.
const NO_LIGATURES = { liga: false, clig: false, dlig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

const MAX_RESUME_PAGES = 2;
const MIN_ROLE_BULLETS = 3;

// Draws the resume, and while it runs past two pages, drops the last bullet of the oldest role that still has
// more than 3, so recent roles keep their detail. Returns how many bullets were dropped.
export async function fitResumePdf(profile: Omit<Profile, "baseResumeText">, content: GeneratedContent) {
  const style = (await loadStyle("resume").catch(() => null)) || DEFAULT_RESUME_STYLE;
  let current = content;
  let dropped = 0;
  for (;;) {
    const drawn = drawResume(profile, current, style);
    const oldest = drawn.pages > MAX_RESUME_PAGES ? current.roles.findLastIndex((role) => role.bullets.length > MIN_ROLE_BULLETS) : -1;
    if (oldest < 0) return { pdf: await drawn.pdf, pages: drawn.pages, dropped };
    await drawn.pdf;
    current = { ...current, roles: current.roles.map((role, index) => (index === oldest ? { ...role, bullets: role.bullets.slice(0, -1) } : role)) };
    dropped += 1;
  }
}

function drawResume(profile: Omit<Profile, "baseResumeText">, content: GeneratedContent, style: typeof DEFAULT_RESUME_STYLE) {
  const w = new Writer(style.page, `${profile.fullName} resume`);
  const left = style.page.left;

  // Header: name, contact line, rule.
  w.at(style.header.name.base);
  w.line([{ text: caseFor(profile.fullName, style.header.name), style: style.header.name }], style.header.name.align);
  w.at(w.y + style.header.contact.gap);
  w.line(contactSegments(profile, style.header.contact), style.header.contact.align);
  let anchor = w.y;
  if (style.header.rule) anchor = w.rule(style.header.rule);

  const sections: Record<string, () => void> = {
    summary: () => {
      const text = content.summary.join(" ");
      w.paragraph(segmentsFor(text, content.summaryBold || []).map((segment) => ({ text: segment.text, style: segment.bold ? { ...style.body, bold: true } : style.body })), { line: style.body.line });
    },
    skills: () => {
      content.skills.forEach((skill, index) => {
        if (index) w.next(style.skill.entryGap, style.skill.items.size);
        w.paragraph(
          [
            { text: `${skill.category}: `, style: style.skill.label },
            ...skill.items.flatMap((item, itemIndex) => [
              ...(itemIndex ? [{ text: ", ", style: { ...style.skill.items, bold: false } }] : []),
              { text: item, style: style.skill.items },
            ]),
          ],
          { line: style.skill.line },
        );
      });
    },
    experience: () => {
      const { role, bullet } = style;
      profile.experiences.forEach((experience, index) => {
        const generated = content.roles[index];
        // Keep a role's title, company line and first bullet on the same page.
        if (index) {
          const page = w.pageNumber;
          w.next(role.roleGap, role.title.size, role.titleToMeta + role.metaToNext + bullet.line);
          // The divider separates two roles on one page; a role that opens a page needs none.
          if (role.divider && w.pageNumber === page) w.ruleAt(w.y - role.divider.above, role.divider);
        } else w.keep(role.titleToMeta + role.metaToNext + bullet.line);
        const dates = `${experience.startDate} – ${experience.endDate}`;
        const datesStyle = role.dates || role.meta;
        // Text beside right-aligned dates wraps before reaching them instead of running into them.
        const besideDates = w.contentRight - w.width(dates, datesStyle) - 12;
        const separator = joinText(role.meta.separator);
        // Most templates put the job title on top and "Company · Location" under it; some put the company on top.
        const top = role.companyFirst ? experience.companyName : experience.jobTitle;
        const place = [role.companyFirst ? experience.jobTitle : experience.companyName, experience.companyAddress].join(separator);
        if (role.meta.datesOn === "title") {
          // Dates at the right of the top line, then the second line.
          w.line([{ text: dates, style: datesStyle }], "right");
          w.paragraph([{ text: top, style: role.title }], { line: role.title.size * 1.2, right: besideDates });
          w.next(role.titleToMeta, role.meta.size);
          w.paragraph([{ text: place, style: role.meta }], { line: role.meta.size * 1.25 });
        } else {
          w.paragraph([{ text: top, style: role.title }], { line: role.title.size * 1.2 });
          w.next(role.titleToMeta, role.meta.size);
          if (role.meta.datesRight) {
            w.line([{ text: dates, style: datesStyle }], "right");
            w.paragraph([{ text: place, style: role.meta }], { line: role.meta.size * 1.25, right: besideDates });
          } else {
            w.paragraph([{ text: `${place}${separator}${dates}`, style: role.meta }], { line: role.meta.size * 1.25 });
          }
        }
        if (generated?.overview) {
          w.next(role.metaToNext, role.overview.size);
          w.paragraph([{ text: generated.overview, style: role.overview }], { line: role.overview.line });
        }
        (generated?.bullets || []).forEach((item, bulletIndex) => {
          const gap = bulletIndex ? bullet.gap : generated?.overview ? role.overviewToBullet : role.metaToNext;
          w.next(gap, bullet.style.size, bullet.line);
          w.draw(bullet.char, left + bullet.bulletIndent, w.y, bullet.mark || bullet.style);
          w.paragraph(bulletSegments(item, bullet.style, bullet.bold), {
            line: bullet.line,
            x: left + bullet.textIndent,
            wrapX: left + bullet.wrapIndent,
          });
        });
      });
    },
    education: () => {
      const { education } = style;
      const gap = Math.abs(education.degreeToSchool);
      profile.education.forEach((school, index) => {
        const first = education.schoolFirst ? education.school : education.degree;
        const second = education.schoolFirst ? education.degree : education.school;
        if (index) w.next(education.entryGap, first.size, gap);
        else w.keep(gap);
        const dates = `${school.startDate} – ${school.endDate}`;
        const datesStyle = education.dates || second;
        const withLocation = (text: string, separator: string) => [text, school.universityLocation].join(joinText(separator));
        const degreeText = education.locationWith === "degree" ? withLocation(school.degree, education.degreeSeparator || education.school.separator) : school.degree;
        const schoolParts = [school.universityName, ...(education.locationWith === "degree" ? [] : [school.universityLocation]), ...(education.datesRight ? [] : [dates])];
        const schoolText = schoolParts.join(joinText(education.school.separator));
        const drawLine = (kind: "school" | "degree", isFirst: boolean) => {
          const style = kind === "school" ? education.school : education.degree;
          const text = kind === "school" ? schoolText : degreeText;
          // Right-aligned dates sit on the entry's first line, as in the template.
          if (education.datesRight && isFirst) {
            w.line([{ text: dates, style: datesStyle }], "right");
            w.paragraph([{ text, style }], { line: style.size * 1.25, right: w.contentRight - w.width(dates, datesStyle) - 12 });
          } else w.paragraph([{ text, style }], { line: style.size * 1.25 });
        };
        drawLine(education.schoolFirst ? "school" : "degree", true);
        w.next(gap, second.size);
        drawLine(education.schoolFirst ? "degree" : "school", false);
      });
    },
  };

  // Space a section's first entry needs, so its heading is never left alone at the bottom of a page.
  const firstEntry: Record<string, number> = {
    summary: style.body.line * 2,
    skills: style.skill.line * 2,
    experience: style.role.titleToMeta + style.role.metaToNext + style.bullet.line * 2,
    education: Math.abs(style.education.degreeToSchool) + style.education.school.size,
  };
  // A section with nothing in it is left out instead of drawn as a bare heading.
  const hasContent: Record<string, boolean> = {
    summary: content.summary.some((sentence) => sentence.trim()),
    skills: content.skills.some((skill) => skill.items.length),
    experience: profile.experiences.length > 0,
    education: profile.education.length > 0,
  };
  style.order.filter((kind) => hasContent[kind] !== false).forEach((kind, index) => {
    const heading = style.heading;
    const headingSpan = heading.rule ? heading.rule.offset + heading.afterRule : heading.gapAfter;
    // The first heading is measured from the header; later ones from the previous section's last line.
    if (index) w.next(heading.sectionGap, heading.size, headingSpan + (firstEntry[kind] || style.body.line));
    else w.at(anchor + style.afterHeader);
    w.line([{ text: caseFor(style.labels[kind], heading), style: heading }], "left");
    if (heading.rule) {
      const ruleY = w.rule(heading.rule);
      w.at(ruleY + heading.afterRule);
    } else {
      w.at(w.y + heading.gapAfter);
    }
    sections[kind]();
  });
  return { pdf: w.finish(), pages: w.pageNumber };
}

export async function renderCoverPdf(profile: Omit<Profile, "baseResumeText">, content: GeneratedContent, company: string, jobTitle: string) {
  const style = (await loadStyle("cover").catch(() => null)) || DEFAULT_COVER_STYLE;
  const w = new Writer(style.page, `${profile.fullName} cover letter`);
  w.at(style.header.name.base);
  w.line([{ text: caseFor(profile.fullName, style.header.name), style: style.header.name }], style.header.name.align);
  w.at(w.y + style.header.contact.gap);
  w.line(contactSegments(profile, style.header.contact), style.header.contact.align);
  const anchor = style.header.rule ? w.rule(style.header.rule) : w.y;

  const today = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
  w.at(anchor + style.date.gap);
  w.line([{ text: today, style: style.date }], "left");
  w.next(style.recipient.gap, style.recipient.size);
  w.line([{ text: "Hiring Manager", style: style.recipient }], "left");
  w.next(style.recipient.line, style.recipient.size);
  w.line([{ text: company, style: style.recipient }], "left");
  w.next(style.subject.gap, style.subject.size);
  w.paragraph([{ text: `Re: ${jobTitle}`, style: style.subject }], { line: style.body.line });

  const body = content.coverLetter.length ? content.coverLetter : ["I am writing to apply for this role."];
  // The greeting gets its own line when the letter does not open with one.
  const paragraphs = /^dear\b/i.test(body[0]) ? body : ["Dear Hiring Manager,", ...body];
  paragraphs.forEach((paragraph, index) => {
    w.next(index ? style.body.paragraphGap : style.body.gap, style.body.size);
    w.paragraph([{ text: paragraph, style: style.body }], { line: style.body.line, justify: style.body.justify });
  });
  w.next(style.closing.gap, style.closing.size, style.signature.gap);
  w.line([{ text: style.closing.text || "Sincerely,", style: style.closing }], "left");
  w.next(style.signature.gap, style.signature.size);
  w.line([{ text: profile.fullName, style: style.signature }], "left");
  return w.finish();
}

// ---------- Content pieces ----------

function contactSegments(profile: Omit<Profile, "baseResumeText">, contact: TextStyle & { separator: string; separatorColor: string; linkColor: string }): Segment[] {
  const link = { ...contact, color: contact.linkColor };
  const separator = { ...contact, color: contact.separatorColor };
  const parts: Segment[] = [
    { text: profile.phone, style: link },
    { text: profile.email, style: link },
    { text: profile.linkedin.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), style: link },
    { text: profile.address, style: contact },
  ].filter((part) => part.text);
  return parts.flatMap((part, index) => (index ? [{ text: joinText(contact.separator), style: separator }, part] : [part]));
}

// Separators are stored with their spacing ("  |  ", ", "); a bare character gets one space on each side.
function joinText(separator: string) {
  return /\s/.test(separator) ? separator : ` ${separator} `;
}

function bulletSegments(bullet: Bullet, style: TextStyle, bold: TextStyle): Segment[] {
  return segmentsFor(bullet.text, bullet.boldPhrases).map((segment) => ({ text: segment.text, style: segment.bold ? bold : style }));
}

function caseFor(text: string, style: TextStyle) {
  return style.upper ? text.toUpperCase() : text;
}

function segmentsFor(text: string, phrases: string[]) {
  const ranges: { start: number; end: number }[] = [];
  const lower = text.toLowerCase();
  const ordered = [...phrases].sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    const needle = phrase.toLowerCase();
    // Whole words only, so a bold "Go" does not bold the start of "Google".
    const isWordChar = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}]/u.test(char));
    let start = lower.indexOf(needle);
    while (start >= 0 && ((isWordChar(needle[0]) && isWordChar(lower[start - 1])) || (isWordChar(needle.at(-1)) && isWordChar(lower[start + needle.length])))) {
      start = lower.indexOf(needle, start + 1);
    }
    if (start < 0) continue;
    // Punctuation right after a bold phrase stays with it, so it cannot wrap onto a line by itself.
    const trailing = /^[.,;:!?)]+/.exec(text.slice(start + phrase.length))?.[0].length || 0;
    const end = start + phrase.length + trailing;
    if (ranges.some((range) => start < range.end && end > range.start)) continue;
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  if (!ranges.length) return [{ text, bold: false }];
  const segments: { text: string; bold: boolean }[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), bold: false });
    segments.push({ text: text.slice(range.start, range.end), bold: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), bold: false });
  return segments.filter((segment) => segment.text);
}

// ---------- Drawing ----------

// Places text by baseline, wraps it word by word in mixed styles, and starts new pages at the template's margins.
class Writer {
  private doc: Doc;
  private done: Promise<Buffer>;
  private fonts = new Set<string>();
  private page: PageStyle;
  y = 0;

  constructor(page: PageStyle, title: string) {
    this.page = page;
    this.doc = new PDFDocument({ size: [page.width, page.height], margin: 0, info: { Title: title } });
    this.done = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
    });
  }

  finish() {
    this.doc.end();
    return this.done;
  }

  private get left() {
    return this.page.left;
  }

  get contentRight() {
    return this.right;
  }

  private get right() {
    return this.page.width - this.page.right;
  }

  private get limit() {
    return this.page.height - this.page.bottom;
  }

  at(base: number) {
    this.y = base;
  }

  // Moves to the next baseline; starts a new page when it (plus any space to keep with it) would not fit.
  next(gap: number, size: number, keepWith = 0) {
    if (this.y + gap + keepWith > this.limit) this.newPage(size);
    else this.y += gap;
  }

  // Starts a new page now if the given space below the current line would not fit.
  keep(space: number) {
    if (this.y + space > this.limit) this.newPage(10);
  }

  pageNumber = 1;

  private newPage(size: number) {
    this.pageNumber += 1;
    this.doc.addPage({ size: [this.page.width, this.page.height], margin: 0 });
    this.y = this.page.top + size * 0.8;
  }

  private use(style: TextStyle) {
    const font = resolveFont(style.font, style.bold, style.italic);
    if (font.file && !this.fonts.has(font.key)) {
      this.doc.registerFont(font.key, font.file);
      this.fonts.add(font.key);
    }
    this.doc.font(font.key).fontSize(style.size);
    return font.key;
  }

  width(text: string, style: TextStyle) {
    return this.pieces(text, style).reduce((sum, piece) => {
      this.use(piece.style);
      return sum + this.doc.widthOfString(piece.text, { features: NO_LIGATURES });
    }, 0);
  }

  draw(text: string, x: number, base: number, style: TextStyle) {
    let left = x;
    for (const piece of this.pieces(text, style)) {
      this.use(piece.style);
      this.doc.fillColor(piece.style.color).text(piece.text, left, base, { lineBreak: false, baseline: "alphabetic", features: NO_LIGATURES });
      left += this.doc.widthOfString(piece.text, { features: NO_LIGATURES });
    }
  }

  // Letters the template's font has no glyph for (Georgia has no "Ș", for example) are drawn in Arial,
  // in the same size, weight and color, instead of printing as empty boxes.
  private pieces(text: string, style: TextStyle): Segment[] {
    this.use(style);
    const font = (this.doc as unknown as { _font?: { font?: { hasGlyphForCodePoint?: (code: number) => boolean } } })._font?.font;
    if (!font?.hasGlyphForCodePoint || /^[\x20-\x7e]*$/.test(text)) return [{ text, style }];
    const fallback: TextStyle = { ...style, font: { family: "Arial", generic: "sans-serif" } };
    const pieces: Segment[] = [];
    for (const char of text) {
      const covered = /\s/.test(char) || font.hasGlyphForCodePoint(char.codePointAt(0) || 0);
      const pieceStyle = covered ? style : fallback;
      const last = pieces.at(-1);
      if (last && last.style === pieceStyle) last.text += char;
      else pieces.push({ text: char, style: pieceStyle });
    }
    return pieces;
  }

  // One line of segments; shrinks it to fit the width when needed (long contact lines).
  line(segments: Segment[], align: Align) {
    const available = this.right - this.left;
    let parts = segments;
    let total = parts.reduce((sum, part) => sum + this.width(part.text, part.style), 0);
    if (total > available) {
      const scale = Math.max(0.6, available / total);
      parts = segments.map((part) => ({ ...part, style: { ...part.style, size: part.style.size * scale } }));
      total = parts.reduce((sum, part) => sum + this.width(part.text, part.style), 0);
    }
    let x = align === "center" ? this.left + (available - total) / 2 : align === "right" ? this.right - total : this.left;
    for (const part of parts) {
      this.draw(part.text, x, this.y, part.style);
      x += this.width(part.text, part.style);
    }
  }

  rule(rule: RuleStyle) {
    return this.ruleAt(this.y + rule.offset, rule);
  }

  ruleAt(y: number, rule: { color: string; width: number }) {
    this.doc.save().moveTo(this.left, y).lineTo(this.right, y).lineWidth(rule.width).strokeColor(rule.color).stroke().restore();
    return y;
  }

  // Wrapped text in mixed styles. The first line sits on the current baseline; later lines follow at `line`.
  // `right` narrows the lines, for text beside right-aligned dates.
  paragraph(segments: Segment[], options: { line: number; x?: number; wrapX?: number; justify?: boolean; right?: number }) {
    const firstX = options.x ?? this.left;
    const wrapX = options.wrapX ?? firstX;
    const right = Math.max(wrapX + 40, Math.min(this.right, options.right ?? this.right));
    const words: Segment[] = [];
    for (const segment of segments) {
      for (const piece of segment.text.split(/(\s+)/)) {
        if (!piece) continue;
        // A word wider than a whole line (a long URL) is broken into pieces that fit.
        if (/\s/.test(piece) || this.width(piece, segment.style) <= right - wrapX) words.push({ text: piece, style: segment.style });
        else for (const part of this.breakWord(piece, segment.style, right - wrapX)) words.push({ text: part, style: segment.style });
      }
    }
    const lines: Segment[][] = [];
    let current: Segment[] = [];
    let used = 0;
    let lineWidth = right - firstX;
    for (const word of words) {
      const isSpace = /^\s+$/.test(word.text);
      if (isSpace) {
        // Spacing inside a line is kept as written (such as "  |  " separators); line breaks drop it.
        if (current.length) {
          const space = word.text.replace(/[\r\n\t]/g, " ");
          current.push({ text: space, style: word.style });
          used += this.width(space, word.style);
        }
        continue;
      }
      const size = this.width(word.text, word.style);
      if (used + size > lineWidth && current.some((item) => item.text.trim())) {
        while (current.length && !current[current.length - 1].text.trim()) current.pop();
        lines.push(current);
        current = [];
        used = 0;
        lineWidth = right - wrapX;
      }
      current.push(word);
      used += size;
    }
    while (current.length && !current[current.length - 1].text.trim()) current.pop();
    if (current.length) lines.push(current);

    lines.forEach((line, index) => {
      if (index) this.next(options.line, line[0]?.style.size || 10);
      const x0 = index ? wrapX : firstX;
      const natural = line.reduce((sum, part) => sum + this.width(part.text, part.style), 0);
      const isGap = (part: Segment) => /^\s+$/.test(part.text);
      const spaces = line.filter(isGap).length;
      const extra = options.justify && index < lines.length - 1 && spaces ? (right - x0 - natural) / spaces : 0;
      let x = x0;
      for (const part of line) {
        if (!isGap(part)) this.draw(part.text, x, this.y, part.style);
        x += this.width(part.text, part.style) + (isGap(part) ? extra : 0);
      }
    });
  }

  // Splits a word into pieces no wider than `max`, preferring to break after "/", "-", "." or "_".
  private breakWord(word: string, style: TextStyle, max: number) {
    const pieces: string[] = [];
    let rest = word;
    while (rest && this.width(rest, style) > max) {
      let cut = 1;
      while (cut < rest.length && this.width(rest.slice(0, cut + 1), style) <= max) cut += 1;
      const soft = Math.max(...["/", "-", ".", "_", "?", "&"].map((char) => rest.lastIndexOf(char, cut - 1)));
      if (soft > cut / 2) cut = soft + 1;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) pieces.push(rest);
    return pieces;
  }
}
