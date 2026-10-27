// Shrinks a job description before it is sent to OpenAI by removing text that never helps
// tailor a resume: EEO statements, benefits, pay transparency, privacy, accommodations, how to apply.
// Responsibilities, requirements, and the company description are kept.

const MAX_CHARS = 8000;

const BOILERPLATE_HEADING = new RegExp(
  "^(" +
    [
      "(our |the )?benefits?( (and|&) perks)?",
      "perks( (and|&) benefits)?",
      "what we offer( you)?",
      "why you('|’)?ll love (working )?(here|with us)",
      "compensation( (and|&) benefits)?",
      "salary( range)?",
      "pay (range|transparency)( notice| statement)?",
      "equal (employment )?opportunity( employer| statement)?",
      "eeo( statement)?",
      "diversity(,? equity,?)?( (and|&) inclusion)?( statement)?",
      "(reasonable )?accommodations?( for applicants)?",
      "(applicant |candidate )?privacy( notice| policy| statement)?",
      "how to apply",
      "application process",
      "e-?verify",
      "background checks?",
      "disclaimer",
      "notice to (applicants|recruiters|agencies)",
      "(to )?recruit(ment|ing) agencies",
    ].join("|") +
    ")$",
  "i",
);

const BOILERPLATE_LINE =
  /(equal opportunity employer|without regard to (race|age|sex)|regardless of (race|age|sex)|protected veteran|e-verify|reasonable accommodation|applicant privacy|privacy (policy|notice|statement)|unsolicited (resumes|applications)|recruitment agencies|pay transparency|will receive consideration for employment|cookies?\b.*\b(experience|preferences|consent|policy|statement)|manage your preferences|all rights reserved|copyright ©|terms of (service|use))/i;

export function condenseJobText(text: string) {
  let result = removeBoilerplate(text);
  if (result.length > MAX_CHARS) {
    const cut = result.lastIndexOf("\n", MAX_CHARS);
    result = result.slice(0, cut > MAX_CHARS / 2 ? cut : MAX_CHARS).trim();
  }
  // Never send less than a usable description; fall back to the original if trimming removed too much.
  return result.split(/\s+/).length >= 40 ? result : text.trim().slice(0, MAX_CHARS);
}

// The text without boilerplate sections and lines. With sections off, only boilerplate lines are removed;
// that is used to judge whole web pages, where menu entries such as "Benefits" look like section headings.
export function removeBoilerplate(text: string, sections = true) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim());
  const kept: string[] = [];
  const seen = new Set<string>();
  let skipping = false;
  for (let line of lines) {
    if (!line) {
      if (!skipping && kept.length && kept.at(-1) !== "") kept.push("");
      continue;
    }
    if (sections && isHeading(line)) {
      skipping = BOILERPLATE_HEADING.test(headingText(line));
      if (skipping) continue;
    }
    if (skipping) continue;
    if (BOILERPLATE_LINE.test(line)) {
      // Some pages put the whole description on one line, so long lines lose only their boilerplate sentences.
      if (line.split(/\s+/).length <= 40) continue;
      line = line.split(/(?<=[.!?])\s+/).filter((sentence) => !BOILERPLATE_LINE.test(sentence)).join(" ");
      if (!line) continue;
    }
    const key = line.toLowerCase();
    if (line.length > 30 && seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function headingText(line: string) {
  return line.replace(/^[#*•\-\s]+/, "").replace(/[:*\s]+$/, "").trim();
}

function isHeading(line: string) {
  const text = headingText(line);
  return text.length > 0 && text.length <= 60 && text.split(/\s+/).length <= 8 && !/[.!?]$/.test(text) && !/^[•\-*]/.test(line);
}
