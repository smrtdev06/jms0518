import type { Bullet, Experience, GeneratedContent } from "./types";

export type TailoredApplication = {
  content: GeneratedContent;
  titles: string[];
};

// Splits the model's markdown into the resume fields the PDF builder already draws.
export function parseTailoredApplication(raw: string, experiences: Experience[], fullName: string): TailoredApplication {
  const text = raw.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
  const resumeAt = text.search(/^#\s*RESUME\s*$/im);
  const coverAt = text.search(/^#\s*COVER LETTER\s*$/im);
  const resume = resumeAt >= 0 ? text.slice(resumeAt, coverAt > resumeAt ? coverAt : undefined) : coverAt >= 0 ? text.slice(0, coverAt) : text;
  const cover = coverAt >= 0 ? text.slice(coverAt) : "";
  const roles = matchRoles(splitRoles(section(resume, "Experience")), experiences);
  const titles = roles.map((role) => role?.title || "");
  return {
    titles,
    content: {
      company: "",
      jobTitle: "",
      summary: summaryText(section(resume, "Summary")),
      summaryBold: boldPhrases(section(resume, "Summary")).slice(0, MAX_BOLD),
      skills: parseSkills(section(resume, "Skills")),
      roles: roles.map((role) => ({
        overview: role?.overview || "",
        bullets: (role?.bullets || []).map(cleanBullet).filter((bullet) => bullet.text),
      })),
      coverLetter: coverParagraphs(cover, fullName),
      ats: { matchedKeywords: [], missingKeywords: [] },
    },
  };
}

function section(resume: string, name: string) {
  const match = new RegExp(`^##\\s+(?:[^\\n]*?\\b)?${name}\\b[^\\n]*$`, "im").exec(resume);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const rest = resume.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function splitRoles(block: string) {
  const parts = block.split(/^###\s+/m).slice(1);
  return parts.map((part) => {
    const [heading, ...body] = part.split("\n");
    const lines = body.join("\n").split("\n");
    const bullets: string[] = [];
    const prose: string[] = [];
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) bullets.push(bullet[1].trim());
      else if (bullets.length && line.trim() && /^\s+\S/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
      else if (line.trim()) prose.push(line.trim());
    }
    return { title: roleTitle(heading || ""), company: roleCompany(heading || ""), overview: prose.join(" "), bullets };
  });
}

type ParsedRole = ReturnType<typeof splitRoles>[number];

// Pairs each profile job with the model's role for the same company, so a role the model skipped
// leaves that job empty (and it is asked for again) instead of shifting later bullets onto the wrong employer.
// Roles without a recognizable company fall back to their position.
function matchRoles(parsed: ParsedRole[], experiences: Experience[]) {
  const used = new Set<number>();
  const matched: (ParsedRole | undefined)[] = experiences.map((experience) => {
    const want = companyKey(experience.companyName);
    const index = parsed.findIndex((role, at) => !used.has(at) && role.company && sameCompany(companyKey(role.company), want));
    if (index < 0) return undefined;
    used.add(index);
    return parsed[index];
  });
  // When the model wrote no company names at all, keep the old order-based pairing.
  if (!parsed.some((role) => role.company)) return experiences.map((_, index) => parsed[index]);
  // A job whose company the model reworded still takes the role in its own position, if nothing else claimed it.
  return matched.map((role, index) => role || (used.has(index) || !parsed[index] ? undefined : (used.add(index), parsed[index])));
}

function companyKey(value: string) {
  return value.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc|technologies|technology)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
}

function sameCompany(a: string, b: string) {
  return Boolean(a && b) && (a === b || a.includes(b) || b.includes(a));
}

// "Backend Engineer — [Acme](https://acme.com) · Jan 2020 – Present" -> "Acme"
function roleCompany(heading: string) {
  // The dates come after the last " · " and contain their own dash, so drop them before splitting on dashes.
  // Titles may contain " | " ("AI Engineer | LLM Consultant"), so "|" only ends the company, never the title.
  const plain = heading.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "").replace(/\s+·\s+[^·]*$/, "").trim();
  const dash = /\s+[—–]\s+/.exec(plain) || /\s+-\s+/.exec(plain);
  if (!dash) return "";
  return plain.slice(dash.index + dash[0].length).split(/\s+[|·]\s+/)[0].trim();
}

function roleTitle(heading: string) {
  const plain = heading.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "").trim();
  const title = plain.split(/\s+[—–·]\s+|\s+-\s+/)[0]?.trim() || "";
  return title.length > 120 ? "" : title;
}

function summaryText(block: string) {
  const plain = strip(block).replace(/^[-*]\s+/gm, "").replace(/\s+/g, " ").trim();
  if (!plain) return [];
  const sentences = plain.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  return sentences.length ? sentences : [plain];
}

// The prompt asks for 2–4 bold terms per summary and bullet; models sometimes bold far more, which reads as noise.
// The first ones written are kept.
const MAX_BOLD = 4;

function boldPhrases(block: string) {
  const phrases = [...block.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => strip(match[1]).replace(/[.,;:]+$/, "").trim());
  return [...new Set(phrases.filter((phrase) => phrase && phrase.length <= 60))];
}

function parseSkills(block: string) {
  const skills: { category: string; items: string[] }[] = [];
  let current: { category: string; items: string[] } | null = null;
  const finish = () => {
    if (current?.items.length) skills.push({ category: current.category, items: [...new Set(current.items)] });
    current = null;
  };
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const headed = categoryLine(line);
    if (headed) {
      finish();
      current = { category: headed.category, items: headed.items };
      continue;
    }
    // A plain list with no category ("Python, Go, AWS") is kept under one "Skills" category instead of being dropped.
    if (!current) current = { category: "Skills", items: [] };
    current.items.push(...skillItems(line.replace(/^[-*]\s+/, "")));
  }
  finish();
  return skills;
}

// A category is either "**Languages**: Python, Go" on one line, or "**Languages**" with the list on the following lines.
function categoryLine(line: string) {
  const match = line.match(/^(?:[-*]\s*)?\*\*([^*]+)\*\*\s*:?\s*(.*)$/) || line.match(/^(?:[-*]\s*)?([A-Za-z][^:]{0,40}):\s*(.*)$/);
  if (!match) return null;
  const category = strip(match[1]).replace(/:$/, "").trim();
  if (!category || category.length > 40) return null;
  return { category, items: skillItems(match[2]) };
}

function skillItems(text: string) {
  return strip(text)
    .split(/\s*(?:,|;|\||·|•)\s*/)
    .map((item) => item.replace(/^and\s+/i, "").replace(/[.]{1,}$/, "").trim())
    .filter((item) => item && item.length < 80 && !/^[-*]$/.test(item));
}

function coverParagraphs(block: string, fullName: string) {
  const name = fullName.trim().toLowerCase();
  return block
    .replace(/^#\s*COVER LETTER\s*/i, "")
    .split(/\n\s*\n/)
    .map((paragraph) => strip(paragraph))
    .map(stripSignoff)
    .filter(Boolean)
    .filter((paragraph) => !isClosing(paragraph, name));
}

function isClosing(paragraph: string, name: string) {
  const text = paragraph.trim();
  if (name && text.toLowerCase() === name) return true;
  return /^(sincerely|best regards|kind regards|warm regards|regards|respectfully|yours truly|yours sincerely)[,.]?(\s+\S.*){0,1}$/i.test(text);
}

function cleanBullet(raw: string): Bullet {
  const bolds: string[] = [];
  const stripped = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, (_, word: string) => {
    bolds.push(word.trim());
    return word;
  });
  let text = stripped.replace(/__([^_]+)__/g, "$1").replace(/`/g, "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
  if (text && !/[.!?]$/.test(text)) text += ".";
  return {
    text,
    boldPhrases: [...new Set(bolds.filter((phrase) => phrase && text.toLowerCase().includes(phrase.toLowerCase())))].slice(0, MAX_BOLD),
  };
}

function strip(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSignoff(text: string) {
  const closings = [...text.matchAll(/\b(sincerely|best regards|kind regards|warm regards|warmest regards|regards|respectfully|yours truly|yours sincerely|with gratitude)\b/gi)];
  const last = closings.at(-1);
  if (last?.index === undefined) return text.trim();
  const tail = text.slice(last.index + last[0].length);
  return /^[,.!]?(\s+[A-Z][\w.'’-]*(\s+[A-Z][\w.'’-]*){0,3})?\.?\s*$/.test(tail) ? text.slice(0, last.index).trim() : text.trim();
}
