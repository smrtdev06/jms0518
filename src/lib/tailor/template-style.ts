import type { FontRef } from "./fonts";
import { type Line, type Parsed, type Run, parsePdf, round } from "./pdf-layout";

// Reads the visual style of an uploaded resume or cover letter template PDF, so generated PDFs
// can be drawn the same way. All distances are in PDF points; "base" values are text baselines
// measured from the top of the page, and gaps are baseline-to-baseline distances.
export type Align = "left" | "center" | "right";
export type TextStyle = { font: FontRef; bold: boolean; italic: boolean; size: number; color: string; upper?: boolean };
export type RuleStyle = { color: string; width: number; offset: number };
export type PageStyle = { width: number; height: number; top: number; bottom: number; left: number; right: number };
type HeaderStyle = {
  name: TextStyle & { align: Align; base: number };
  contact: TextStyle & { align: Align; gap: number; separator: string; separatorColor: string; linkColor: string };
  rule: RuleStyle | null;
};
type SectionKind = "summary" | "skills" | "experience" | "education";

export type ResumeStyle = {
  kind: "resume";
  page: PageStyle;
  header: HeaderStyle;
  afterHeader: number;
  heading: TextStyle & { rule: RuleStyle | null; afterRule: number; gapAfter: number; sectionGap: number };
  labels: Record<SectionKind, string>;
  order: SectionKind[];
  body: TextStyle & { line: number };
  bold: TextStyle;
  skill: { label: TextStyle; items: TextStyle; line: number; entryGap: number };
  role: {
    title: TextStyle;
    // Dates sit either on the company line ("meta") or at the right of the job title line ("title").
    meta: TextStyle & { separator: string; datesRight: boolean; datesOn?: "meta" | "title" };
    dates?: TextStyle;
    overview: TextStyle & { line: number };
    titleToMeta: number;
    metaToNext: number;
    overviewToBullet: number;
    roleGap: number;
    // The bold top line holds the company, and the line under it "Job title · Location".
    companyFirst?: boolean;
    // A thin line between roles, drawn `above` points over the next role's top baseline.
    divider?: { color: string; width: number; above: number };
  };
  bullet: { char: string; mark?: TextStyle; style: TextStyle; bold: TextStyle; bulletIndent: number; textIndent: number; wrapIndent: number; line: number; gap: number };
  education: {
    degree: TextStyle;
    school: TextStyle & { separator: string };
    // Distance between the two lines of an entry, whichever comes first.
    degreeToSchool: number;
    entryGap: number;
    schoolFirst?: boolean;
    // Dates at the right of the first line, in their own style.
    datesRight?: boolean;
    dates?: TextStyle;
    // Which line carries the location: "University · Austin" or "Degree · Austin".
    locationWith?: "school" | "degree";
    degreeSeparator?: string;
  };
  // Styles from older versions of the reader are read from the template again.
  version?: number;
};

// Raise when the reader learns something new, so stored styles are refreshed from the template PDF.
export const STYLE_VERSION = 2;

export type CoverStyle = {
  kind: "cover";
  page: PageStyle;
  header: HeaderStyle;
  date: TextStyle & { gap: number };
  recipient: TextStyle & { gap: number; line: number };
  subject: TextStyle & { gap: number };
  body: TextStyle & { gap: number; line: number; paragraphGap: number; justify: boolean };
  bold: TextStyle;
  closing: TextStyle & { gap: number; text?: string };
  signature: TextStyle & { gap: number };
};

const HEADINGS: Record<SectionKind, RegExp> = {
  summary: /^(professional |career |executive )?(summary|profile|objective|about( me)?)$/i,
  skills: /^((technical|core|key|relevant) )?(skills|competencies|technologies|expertise|tech stack)( (&|and) \w+)?$/i,
  experience: /^((professional|work|relevant|employment) )?(experience|employment( history)?|work history|career history)$/i,
  education: /^(education|academic background|education (&|and) \w+)$/i,
};
const DATE_RANGE =
  /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*(–|-|—|to)\s*(((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}|present|current|now)/i;
const LETTER_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(19|20)\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-](19|20)?\d{2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(19|20)\d{2}\b/i;
const BULLET = /^\s*([•●▪■◦‣∙·➢►▸✓✔\-–*])\s*/;
const SEPARATORS = ["|", "·", "•", "◆", "⋅", "—", "–", "/"];
const CLOSING = /^(sincerely|best regards|kind regards|warm regards|regards|respectfully|yours (truly|sincerely)|with gratitude|thank you)[,.!]?$/i;

export async function analyzeTemplate(kind: "resume" | "cover", bytes: Buffer): Promise<ResumeStyle | CoverStyle> {
  const parsed = await parsePdf(bytes);
  if (!parsed.lines.length) throw new Error("No text was found in this PDF. Upload a PDF with selectable text, not a scanned image.");
  return kind === "resume" ? resumeStyle(parsed) : coverStyle(parsed);
}

// ---------- Shared pieces ----------

function headerStyle(parsed: Parsed) {
  const first = parsed.lines.filter((line) => line.page === 1);
  if (!first.length) throw new Error("The first page of this PDF has no text. Upload a PDF with selectable text, not a scanned image.");
  const name = first.reduce((best, line) => (line.size > best.size + 0.5 ? line : best), first[0]);
  // The contact line is the first line under the name with an email, phone, or link; a headline in between
  // ("Senior Software Engineer") is skipped.
  const underName = first.filter((line) => line.base > name.base);
  const contact = underName.slice(0, 4).find((line) => /@|linkedin|https?:|www\.|\+?\d[\d\s().-]{6,}\d/i.test(line.text)) || underName[0];
  if (!contact) throw new Error("Could not find the contact line under the name.");
  const nameStyle = dominant(name.runs);
  const separator = SEPARATORS.find((char) => contact.text.includes(` ${char} `) || contact.runs.some((run) => run.text.trim() === char)) || "|";
  const separatorRun = contact.runs.find((run) => run.text.trim() === separator);
  const linkRun = contact.runs.find((run) => /@|linkedin|\d{3}/i.test(run.text));
  const contactStyle = dominant(contact.runs.filter((run) => run.text.trim() !== separator));
  const lastRun = [...contact.runs].reverse().find((run) => run.text.trim() && run.text.trim() !== separator);
  const below = first.find((line) => line.base > contact.base);
  const rule = parsed.rules.find((item) => item.page === 1 && item.y > contact.base && (!below || item.y < below.base));
  return {
    nameLine: name,
    contactLine: contact,
    rule,
    header: {
      name: { ...nameStyle, upper: isUpper(name.text), align: alignment(name, parsed), base: round(name.base) },
      contact: {
        ...contactStyle,
        color: lastRun?.color || contactStyle.color,
        align: alignment(contact, parsed),
        gap: round(contact.base - name.base),
        separator: joiner(contact.runs) || ` ${separator} `,
        separatorColor: separatorRun?.color || contactStyle.color,
        linkColor: linkRun?.color || contactStyle.color,
      },
      rule: rule ? { color: rule.color, width: rule.thickness, offset: round(rule.y - contact.base) } : null,
    } satisfies HeaderStyle,
  };
}

function pageStyle(parsed: Parsed, name: Line): PageStyle {
  const content = parsed.lines.filter((line) => line.text.length > 3);
  const left = Math.min(...content.map((line) => line.x0));
  const rights = content.map((line) => line.x1).sort((a, b) => a - b);
  const right = parsed.width - rights[Math.floor(rights.length * 0.95)];
  const top = Math.max(18, name.base - name.size);
  const firstPage = parsed.lines.filter((line) => line.page === 1);
  const lowest = Math.max(...firstPage.map((line) => line.base));
  const bottom = parsed.pages > 1 ? Math.max(24, parsed.height - lowest - 6) : top;
  return { width: parsed.width, height: parsed.height, top: round(top), bottom: round(Math.min(bottom, 90)), left: round(left), right: round(Math.max(18, right)) };
}

// ---------- Resume ----------

function resumeStyle(parsed: Parsed): ResumeStyle {
  const { nameLine, contactLine, header } = headerStyle(parsed);
  const page = pageStyle(parsed, nameLine);
  const headings = parsed.lines
    .map((line) => ({ line, kind: (Object.keys(HEADINGS) as SectionKind[]).find((kind) => HEADINGS[kind].test(line.text.replace(/:$/, "").trim())) }))
    .filter((item): item is { line: Line; kind: SectionKind } => Boolean(item.kind) && item.line.text.length < 40);
  const kinds = [...new Set(headings.map((item) => item.kind))];
  if (kinds.length < 3) {
    throw new Error("This PDF does not look like a resume: it needs section headings such as Summary, Skills, Experience and Education.");
  }
  const sections = new Map<SectionKind, { heading: Line; lines: Line[] }>();
  headings.forEach((item, index) => {
    if (sections.has(item.kind)) return;
    const next = headings[index + 1]?.line;
    const lines = parsed.lines.filter((line) => after(line, item.line) && (!next || after(next, line)));
    sections.set(item.kind, { heading: item.line, lines });
  });
  const firstHeading = headings[0].line;
  const headingRun = dominant(firstHeading.runs);
  const headingRule = parsed.rules.find((rule) => rule.page === firstHeading.page && rule.y > firstHeading.base && rule.y < firstHeading.base + firstHeading.size * 3);
  const firstContent = parsed.lines.find((line) => after(line, firstHeading));
  const sectionGaps = headings.slice(1).map((item) => {
    const previous = [...parsed.lines].reverse().find((line) => line.page === item.line.page && line.base < item.line.base - 1);
    return previous ? item.line.base - previous.base : NaN;
  });

  const summary = sections.get("summary")?.lines || [];
  const skills = sections.get("skills")?.lines || [];
  const experience = sections.get("experience")?.lines || [];
  const education = sections.get("education")?.lines || [];
  const plainRuns = (lines: Line[]) => lines.flatMap((line) => line.runs).filter((run) => !run.bold && !BULLET.test(run.text.trim() + " "));
  const boldRuns = (lines: Line[]) => lines.flatMap((line) => line.runs).filter((run) => run.bold);
  const bodyStyle = dominant(plainRuns(summary.length ? summary : experience));
  const boldStyle = boldRuns(summary).length ? dominant(boldRuns(summary)) : { ...bodyStyle, bold: true };

  // Skills: "Label: item, item" lines; wrapped lines have no label.
  const entries = skills.filter((line) => /^[^:]{2,60}:/.test(line.text));
  const labelRuns = entries.map((line) => line.runs.find((run) => run.text.includes(":")) || line.runs[0]);
  const itemRuns = entries.flatMap((line) => {
    const labelIndex = line.runs.findIndex((run) => run.text.includes(":"));
    return line.runs.slice(labelIndex + 1).filter((run) => run.text.trim().length > 1);
  });
  const skillWrap = gaps(skills, (_a, b) => !/^[^:]{2,60}:/.test(b.text));
  const skillEntry = gaps(skills, (_a, b) => /^[^:]{2,60}:/.test(b.text));

  // Experience: a job title line and a company line (the dates on either one), an optional overview, then bullets.
  const isBullet = (line: Line) => BULLET.test(line.text) && line.text.length > 3;
  const dateIndexes = experience.map((line, index) => (DATE_RANGE.test(line.text) && !isBullet(line) ? index : -1)).filter((index) => index >= 0);
  const dateRunsOf = (line: Line) => {
    const last = line.runs.length - 1;
    let start = last;
    while (start > 0 && !/(19|20)\d{2}|present|current/i.test(line.runs[start].text)) start -= 1;
    while (start > 0 && line.runs[start].x - line.runs[start - 1].x1 < 20 && /^[\s–\-—a-z.]*(19|20)?\d*\s*$/i.test(line.runs[start - 1].text)) start -= 1;
    return line.runs.slice(start);
  };
  const datesFarRight = (line: Line) => {
    const dateRuns = dateRunsOf(line);
    const first = dateRuns[0];
    const before = line.runs[line.runs.indexOf(first) - 1];
    return Boolean(before && first.x - before.x1 > 30 && Math.abs(line.x1 - (page.width - page.right)) < 8);
  };
  // Dates on the title line: the left part of the date line looks like a title (bold or larger than the next line).
  const datesOnTitle = dateIndexes.length > 0 && dateIndexes.every((index) => {
    const line = experience[index];
    const next = experience[index + 1];
    const left = line.runs.slice(0, line.runs.indexOf(dateRunsOf(line)[0]));
    return datesFarRight(line) && left.length > 0 && next && !isBullet(next) && !DATE_RANGE.test(next.text) && (dominant(left).bold || dominant(left).size > dominant(next.runs).size);
  });
  const metaIndexes = datesOnTitle ? dateIndexes.map((index) => index + 1) : dateIndexes.filter((index) => index > 0);
  const titles = metaIndexes.map((index) => experience[index - 1]);
  const metas = metaIndexes.map((index) => experience[index]);
  const dateLines = dateIndexes.map((index) => experience[index]);
  const overviewLines: Line[] = [];
  const titleToMeta: number[] = [];
  const metaToNext: number[] = [];
  const overviewToBullet: number[] = [];
  for (const index of metaIndexes) {
    const meta = experience[index];
    const title = experience[index - 1];
    if (title.page === meta.page) titleToMeta.push(meta.base - title.base);
    const next = experience[index + 1];
    if (next && next.page === meta.page) metaToNext.push(next.base - meta.base);
    let cursor = index + 1;
    const overview: Line[] = [];
    while (cursor < experience.length && !isBullet(experience[cursor]) && !metaIndexes.includes(cursor + 1)) overview.push(experience[cursor++]);
    overviewLines.push(...overview);
    const firstBullet = experience[cursor];
    const lastOverview = overview.at(-1);
    if (lastOverview && firstBullet && isBullet(firstBullet) && firstBullet.page === lastOverview.page) overviewToBullet.push(firstBullet.base - lastOverview.base);
  }
  const bulletLines = experience.filter(isBullet);
  const bulletChar = BULLET.exec(bulletLines[0]?.text || "")?.[1] || "•";
  const bulletRunsAll = experience.filter((line) => !titles.includes(line) && !metas.includes(line) && !overviewLines.includes(line)).flatMap((line) => line.runs).filter((run) => run.text.trim() !== bulletChar);
  const firstBulletLine = bulletLines[0];
  const bulletRun = firstBulletLine?.runs[0];
  const textRun = firstBulletLine?.runs.find((run, index) => index > 0 || run.text.trim().length > 1);
  const textX = textRun ? (textRun === bulletRun ? bulletRun.x + (bulletRun.x1 - bulletRun.x) * (2 / Math.max(2, bulletRun.text.length)) : textRun.x) : page.left + 12;
  const continuation = experience.find((line, index) => index > 0 && isBullet(experience[index - 1]) && !isBullet(line) && !titles.includes(line) && !metas.includes(line) && line.page === experience[index - 1].page);
  const inBullet = (a: Line, b: Line) => !isBullet(b) && !titles.includes(b) && !metas.includes(b) && !overviewLines.includes(b) && !overviewLines.includes(a) && !titles.includes(a) && !metas.includes(a);
  const bulletWrap = gaps(experience, inBullet);
  const bulletGap = gaps(experience, (a, b) => isBullet(b) && !metas.includes(a) && !overviewLines.includes(a));
  const roleGap = gaps(experience, (a, b) => titles.includes(b) && !metas.includes(a));
  const metaLine = metas[0];
  const metaRuns = (line: Line) => (datesOnTitle ? line.runs : line.runs.slice(0, Math.max(1, line.runs.indexOf(dateRunsOf(line)[0]))));
  const metaSeparator = metaLine ? joiner(metaRuns(metaLine)) || ", " : "  |  ";
  const datesRight = datesOnTitle || Boolean(metaLine && datesFarRight(metaLine));
  const titleRuns = (line: Line) => (datesOnTitle ? line.runs.slice(0, Math.max(1, line.runs.indexOf(dateRunsOf(line)[0]))) : line.runs);

  // Company first: the top line names no job ("NVIDIA") while the line under it does ("Senior Software Engineer · Remote").
  const textOf = (runs: Run[]) => runs.map((run) => run.text).join(" ");
  const companyFirst = titles.length > 0 && titles.every((line) => !ROLE_WORDS.test(textOf(titleRuns(line)))) && metas.filter((line) => ROLE_WORDS.test(textOf(metaRuns(line)))).length * 2 > metas.length;

  // A thin line between roles: a rule just above a role's top line, below the previous role's last line.
  const dividers = titles.slice(1).flatMap((title) => {
    const previous = experience[experience.indexOf(title) - 1];
    const rule = parsed.rules.find((item) => item.page === title.page && item.thickness <= 1.5 && item.y < title.base - title.size * 0.5 && item.y > (previous && previous.page === title.page ? previous.base : title.base - 60));
    return rule ? [{ rule, above: title.base - rule.y }] : [];
  });
  const divider = dividers.length && dividers.length * 2 >= titles.length - 1 ? { color: dividers[0].rule.color, width: dividers[0].rule.thickness, above: round(median(dividers.map((item) => item.above))) } : undefined;

  // The degree line is recognized by its wording, since some templates put the university first.
  const DEGREE = /\b(bachelor|master|doctor|ph\.?d|mba|b\.?sc|m\.?sc|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|b\.?eng|m\.?eng|associate|diploma|degree|certificate)\b/i;
  const degreeFirst = !(education[1] && DEGREE.test(education[1].text) && !DEGREE.test(education[0]?.text || ""));
  const degree = degreeFirst ? education[0] : education[1];
  const school = degreeFirst ? education[1] : education[0];
  const eduEntry = education[2] && education[1].page === education[2].page ? education[2].base - education[1].base : NaN;
  // "University of Crete            2010 – 2014": dates far right on the school line, styled on their own.
  const eduDatesRight = Boolean(school && DATE_RANGE.test(school.text) && datesFarRight(school));
  const schoolRuns = school ? (eduDatesRight ? school.runs.slice(0, Math.max(1, school.runs.indexOf(dateRunsOf(school)[0]))) : school.runs) : [];
  // "Bachelor of Science · Greece": the location follows the degree when the degree line has a separator and the school line does not.
  const degreeSeparator = degree ? joiner(degree.runs) : "";
  const locationWith = degreeSeparator && !joiner(schoolRuns) ? "degree" : "school";

  const fallbackLine = bodyStyle.size * 1.35;
  const order = [...new Set(headings.map((item) => item.kind))];
  for (const kind of ["summary", "skills", "experience", "education"] as SectionKind[]) if (!order.includes(kind)) order.push(kind);
  const labels: Record<SectionKind, string> = { summary: "SUMMARY", skills: "SKILLS", experience: "EXPERIENCE", education: "EDUCATION" };
  for (const item of headings) if (!labels[item.kind] || labels[item.kind] === item.kind.toUpperCase()) labels[item.kind] = item.line.text.replace(/:$/, "").trim();

  return {
    kind: "resume",
    page,
    header,
    afterHeader: round(firstHeading.base - (header.rule ? contactLine.base + header.rule.offset : contactLine.base)),
    heading: {
      ...headingRun,
      upper: isUpper(firstHeading.text),
      rule: headingRule ? { color: headingRule.color, width: headingRule.thickness, offset: round(headingRule.y - firstHeading.base) } : null,
      afterRule: firstContent && headingRule ? round(firstContent.base - headingRule.y) : round(bodyStyle.size * 1.8),
      gapAfter: firstContent ? round(firstContent.base - firstHeading.base) : round(headingRun.size * 2),
      sectionGap: round(median(sectionGaps) || headingRun.size * 3),
    },
    labels,
    order,
    body: { ...bodyStyle, line: round(median(gaps(summary, () => true)) || fallbackLine) },
    bold: boldStyle,
    skill: {
      label: labelRuns.length ? dominant(labelRuns) : { ...bodyStyle, bold: true },
      items: itemRuns.length ? dominant(itemRuns) : bodyStyle,
      line: round(median(skillWrap) || fallbackLine),
      entryGap: round(median(skillEntry) || fallbackLine * 1.2),
    },
    role: {
      title: titles.length ? dominant(titles.flatMap(titleRuns)) : { ...bodyStyle, bold: true, size: bodyStyle.size + 0.5 },
      meta: {
        ...(metas.length ? dominant(metas.flatMap(metaRuns)) : { ...bodyStyle, italic: true }),
        separator: metaSeparator,
        datesRight,
        datesOn: datesOnTitle ? "title" : "meta",
      },
      dates: dateLines.length ? dominant(dateLines.flatMap(dateRunsOf)) : undefined,
      overview: {
        ...(overviewLines.length ? dominant(overviewLines.flatMap((line) => line.runs)) : { ...bodyStyle, italic: true }),
        line: round(median(gaps(overviewLines, () => true)) || fallbackLine),
      },
      titleToMeta: round(median(titleToMeta) || fallbackLine),
      metaToNext: round(median(metaToNext) || fallbackLine * 1.2),
      overviewToBullet: round(median(overviewToBullet) || fallbackLine * 1.2),
      roleGap: round(median(roleGap) || fallbackLine * 1.8),
      companyFirst,
      divider,
    },
    bullet: {
      char: bulletChar,
      // The bullet symbol's own style (often colored like the headings).
      mark: bulletRun && bulletRun.text.trim() === bulletChar ? dominant([bulletRun]) : undefined,
      style: bulletRunsAll.filter((run) => !run.bold).length ? dominant(bulletRunsAll.filter((run) => !run.bold)) : bodyStyle,
      bold: bulletRunsAll.filter((run) => run.bold).length ? dominant(bulletRunsAll.filter((run) => run.bold)) : boldStyle,
      bulletIndent: round(Math.max(0, (bulletRun?.x ?? page.left) - page.left)),
      textIndent: round(Math.max(0, textX - page.left)),
      wrapIndent: round(Math.max(0, (continuation?.x0 ?? page.left) - page.left)),
      line: round(median(bulletWrap) || fallbackLine),
      gap: round(median(bulletGap) || fallbackLine * 1.25),
    },
    education: {
      degree: degree ? dominant(degree.runs) : { ...bodyStyle, bold: true },
      school: { ...(school ? dominant(schoolRuns) : { ...bodyStyle, italic: true }), separator: joiner(schoolRuns) || metaSeparator },
      // Always positive: the distance from the first line of an entry to the second.
      degreeToSchool: round(degree && school && degree.page === school.page ? Math.abs(school.base - degree.base) : fallbackLine),
      entryGap: round(eduEntry || fallbackLine * 1.8),
      schoolFirst: !degreeFirst,
      datesRight: eduDatesRight,
      dates: eduDatesRight && school ? dominant(dateRunsOf(school)) : undefined,
      locationWith,
      degreeSeparator: degreeSeparator || undefined,
    },
    version: STYLE_VERSION,
  };
}

const ROLE_WORDS = /\b(engineer|developer|programmer|manager|lead|architect|analyst|consultant|designer|scientist|specialist|administrator|director|intern|officer|technician|devops|sre|founder|head of)\b/i;

// ---------- Cover letter ----------

function coverStyle(parsed: Parsed): CoverStyle {
  const { nameLine, contactLine, rule, header } = headerStyle(parsed);
  const page = pageStyle(parsed, nameLine);
  const lines = parsed.lines.filter((line) => after(line, contactLine));
  const anchor = rule ? rule.y : contactLine.base;
  const dateIndex = lines.findIndex((line) => LETTER_DATE.test(line.text));
  const subjectIndex = lines.findIndex((line) => /^(re|subject)\s*:/i.test(line.text));
  const closingIndex = lines.findIndex((line) => CLOSING.test(line.text.trim()));
  if (closingIndex < 0 || (dateIndex < 0 && subjectIndex < 0)) {
    throw new Error("This PDF does not look like a cover letter: it needs a date or a Re: line, body paragraphs, and a closing such as Sincerely.");
  }
  const date = lines[dateIndex];
  const recipientStart = dateIndex >= 0 ? dateIndex + 1 : 0;
  // Without a Re: line, the recipient block runs until the greeting or the first full-width line.
  const fullWidth = (page.width - page.left - page.right) * 0.6;
  const bodyAt = lines.findIndex((line, index) => index >= recipientStart && (/^dear\b/i.test(line.text) || line.x1 - line.x0 >= fullWidth));
  const recipientEnd = subjectIndex >= 0 ? subjectIndex : bodyAt >= 0 ? bodyAt : recipientStart;
  const recipients = lines.slice(recipientStart, recipientEnd).filter((line) => line.x1 - line.x0 < (page.width - page.left - page.right) * 0.6);
  const subject = lines[subjectIndex];
  const bodyStart = Math.max(subjectIndex, recipientStart + recipients.length - 1, dateIndex) + 1;
  const body = lines.slice(bodyStart, closingIndex);
  const closing = lines[closingIndex];
  const signature = lines[closingIndex + 1];
  const bodyGaps = gaps(body, () => true);
  const line = Math.min(...bodyGaps.filter((gap) => gap > 0), Infinity);
  const lineHeight = Number.isFinite(line) ? median(bodyGaps.filter((gap) => gap < line * 1.25)) : 0;
  const paragraphGap = median(bodyGaps.filter((gap) => lineHeight && gap >= lineHeight * 1.25));
  const bodyRuns = body.flatMap((item) => item.runs);
  const bodyStyle = dominant(bodyRuns.filter((run) => !run.bold).length ? bodyRuns.filter((run) => !run.bold) : bodyRuns);
  const full = body.filter((item) => item.x1 - item.x0 > (page.width - page.left - page.right) * 0.8);
  const justify = full.length >= 3 && full.filter((item) => Math.abs(item.x1 - (page.width - page.right)) < 2).length >= full.length * 0.8;
  const previousOf = (target: Line | undefined, fallback: number) => {
    if (!target) return fallback;
    const index = lines.indexOf(target);
    return index > 0 && lines[index - 1].page === target.page ? lines[index - 1].base : anchor;
  };
  const fallbackLine = bodyStyle.size * 1.4;
  return {
    kind: "cover",
    page,
    header,
    date: { ...(date ? dominant(date.runs) : bodyStyle), gap: round(date ? date.base - anchor : fallbackLine * 1.6) },
    recipient: {
      ...(recipients.length ? dominant(recipients.flatMap((item) => item.runs)) : bodyStyle),
      gap: round(recipients[0] ? recipients[0].base - previousOf(recipients[0], anchor) : fallbackLine * 1.5),
      line: round(median(gaps(recipients, () => true)) || fallbackLine),
    },
    subject: { ...(subject ? dominant(subject.runs) : { ...bodyStyle, bold: true }), gap: round(subject ? subject.base - previousOf(subject, anchor) : fallbackLine) },
    body: {
      ...bodyStyle,
      gap: round(body[0] ? body[0].base - previousOf(body[0], anchor) : fallbackLine * 1.5),
      line: round(lineHeight || fallbackLine),
      paragraphGap: round(paragraphGap || (lineHeight || fallbackLine) * 1.6),
      justify,
    },
    bold: bodyRuns.some((run) => run.bold) ? dominant(bodyRuns.filter((run) => run.bold)) : { ...bodyStyle, bold: true },
    closing: { ...dominant(closing.runs), gap: round(closing.base - previousOf(closing, anchor)), text: closing.text.trim() },
    signature: { ...(signature ? dominant(signature.runs) : { ...bodyStyle, bold: true }), gap: round(signature && signature.page === closing.page ? signature.base - closing.base : fallbackLine * 1.6) },
  };
}

// ---------- Helpers ----------

// The separator between parts of a line with its spacing as written, such as "  |  ", " · " or ", ".
function joiner(runs: Run[]) {
  const text = runs.map((run) => run.text).join(" ");
  for (const char of SEPARATORS) {
    const escaped = char.replace(/[|\\/.*+?^${}()[\]-]/g, "\\$&");
    const within = runs.map((run) => run.text.match(new RegExp(`\\S(\\s+${escaped}\\s+)\\S`))?.[1]).find(Boolean);
    if (within) return within;
    if (runs.some((run) => run.text.trim() === char) || text.includes(` ${char} `)) return ` ${char} `;
  }
  return /\S, \S/.test(text) ? ", " : "";
}

function dominant(runs: Run[]): TextStyle {
  const counts = new Map<string, { style: TextStyle; chars: number }>();
  for (const run of runs) {
    const style: TextStyle = { font: run.font, bold: run.bold, italic: run.italic, size: Math.round(run.size * 2) / 2, color: run.color };
    const key = JSON.stringify(style);
    const entry = counts.get(key) || { style, chars: 0 };
    entry.chars += run.text.trim().length;
    counts.set(key, entry);
  }
  const best = [...counts.values()].sort((a, b) => b.chars - a.chars)[0];
  return best?.style || { font: { family: "Helvetica", generic: "sans-serif" }, bold: false, italic: false, size: 10.5, color: "#1a1a1a" };
}

// Baseline distances between consecutive lines on the same page that pass the filter.
function gaps(lines: Line[], keep: (a: Line, b: Line) => boolean) {
  const found: number[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const a = lines[index - 1];
    const b = lines[index];
    if (a.page === b.page && b.base > a.base && keep(a, b)) found.push(b.base - a.base);
  }
  return found;
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function after(line: Line, anchor: Line) {
  return line.page > anchor.page || (line.page === anchor.page && line.base > anchor.base + 0.5);
}

// Centered lines sit on the page's middle and start right of the left margin; right-aligned lines start past the middle.
function alignment(line: Line, parsed: Parsed): Align {
  const left = Math.min(...parsed.lines.filter((item) => item.text.length > 3).map((item) => item.x0));
  const center = (line.x0 + line.x1) / 2;
  if (Math.abs(center - parsed.width / 2) < parsed.width * 0.025 && line.x0 > left + 3) return "center";
  if (line.x0 > parsed.width * 0.5) return "right";
  return "left";
}

function isUpper(text: string) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length > 2 && letters === letters.toUpperCase();
}

// A short, readable description of a style for the upload response.
export function summarizeStyle(style: ResumeStyle | CoverStyle) {
  const describe = (text: TextStyle) => `${text.font.family} ${text.size}pt${text.bold ? " bold" : ""}${text.italic ? " italic" : ""} ${text.color}${text.upper ? " uppercase" : ""}`;
  const rule = (item: RuleStyle | null) => (item ? `${item.width}pt ${item.color}` : "none");
  const common = {
    page: `${style.page.width} x ${style.page.height} pt, margins ${style.page.top}/${style.page.right}/${style.page.bottom}/${style.page.left}`,
    name: `${describe(style.header.name)}, ${style.header.name.align}`,
    contact: `${describe(style.header.contact)}, links ${style.header.contact.linkColor}, separator "${style.header.contact.separator}", ${style.header.contact.align}`,
    headerRule: rule(style.header.rule),
  };
  if (style.kind === "resume") {
    return {
      ...common,
      sections: style.order.map((kind) => style.labels[kind]).join(" → "),
      heading: `${describe(style.heading)}, rule ${rule(style.heading.rule)}`,
      body: describe(style.body),
      jobTitle: describe(style.role.title),
      companyLine: `${describe(style.role.meta)}, separator "${style.role.meta.separator}"${style.role.meta.datesOn === "title" ? ", dates at the right of the job title" : style.role.meta.datesRight ? ", dates on the right" : ""}`,
      bullets: `"${style.bullet.char}" ${describe(style.bullet.style)}`,
      roleOrder: style.role.companyFirst ? "company on top, job title under it" : "job title on top, company under it",
      roleDivider: style.role.divider ? `${style.role.divider.width}pt ${style.role.divider.color}` : "none",
      education: `${style.education.schoolFirst ? "school first" : "degree first"}, location with the ${style.education.locationWith || "school"}${style.education.datesRight ? ", dates on the right" : ""}`,
    };
  }
  return {
    ...common,
    date: describe(style.date),
    subject: describe(style.subject),
    body: `${describe(style.body)}${style.body.justify ? ", justified" : ""}`,
    signature: describe(style.signature),
  };
}
