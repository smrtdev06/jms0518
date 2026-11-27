import { removeBoilerplate } from "./job-text";

// The result of reading a job link, and the checks every read method shares (is the text a usable job
// description, a bot wall, a closed posting; which heading is the job title).

export const JOB_SIGNAL =
  /(responsibilit|requirement|qualification|what you(?:'|’)?ll|about the role|about the job|we(?:'|’)?re looking|you will|experience with|preferred|your background|the opportunity)/i;

export const BLOCKED =
  /captcha|cf-browser-verification|attention required|access denied|just a moment|bot detection|performing security verification|verify (that )?you are (a )?human|human verification|are you a robot/i;

export const CLOSED =
  /(page you are looking for (doesn'?t|does not) exist|job (posting )?(is )?no longer (available|active|open|accepting)|(position|job|requisition) (has been|is) (filled|closed|removed)|this job (has )?(expired|closed)|no longer accepting applications|job (posting )?not found|posting (has )?expired)/i;

export type FetchResult = {
  ok: boolean;
  url: string;
  company: string;
  title: string;
  location: string;
  text: string;
  source: string;
  error: string;
  companyUrl?: string;
  // Structured job data (JobPosting, job-board APIs) is complete even when it is short.
  trusted?: boolean;
  // A failure no other read method can fix, such as a link to a whole career site.
  final?: boolean;
};

export type Log = (message: string) => void;

export type ReadHtml = (url: string, log: Log, signal?: AbortSignal) => Promise<FetchResult>;

// Section headings that pages sometimes put where the job title belongs.
export const GENERIC_TITLE =
  /^(about (the )?(job|role|position|opportunity|team|company|us)|(the )?(job|role|position|opportunity)( (description|details|summary|overview|posting))?|overview|careers?|jobs?|job (openings?|board|search)|open (positions|roles)|apply( now)?|home|welcome|untitled|details|description)$/i;

export function isGenericTitle(value: string) {
  return GENERIC_TITLE.test(value.replace(/[\s:|\-–—]+$/g, "").trim());
}

export const JOB_WORD =
  /\b(engineer|developer|programmer|architect|analyst|scientist|designer|manager|director|lead|head|specialist|consultant|administrator|admin|associate|intern|coordinator|officer|technician|representative|advocate|strategist|researcher|writer|editor|accountant|recruiter|sales|marketing|support|operations|product|owner|principal|staff|senior|junior|devops|sre|qa|tester|teacher|nurse|assistant|executive|partner|agent|controller|planner|buyer|trainer|instructor)\b/i;

// The best job title among the candidates. Headings are used whole, since titles such as
// "Engineer - Security" contain dashes; page titles like "Role | Company" are split into parts.
// Candidates that read like a job title win over logos and site names.
export function pickTitle(headings: string[], pageTitles: string[] = [], exclude: string[] = []) {
  const skip = new Set(exclude.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const options: string[] = [];
  const add = (value: string) => {
    const title = value.replace(/\s+/g, " ").replace(/\s+(in|at)$/i, "").trim();
    if (title && title.length <= 120 && !isGenericTitle(title) && !skip.has(title.toLowerCase())) options.push(title);
  };
  headings.forEach((heading) => add(String(heading || "")));
  pageTitles.forEach((pageTitle) => String(pageTitle || "").split(/\s[|\-–—]\s|\s\|/).forEach(add));
  return options.find((title) => JOB_WORD.test(title)) || options[0] || "";
}

export function composeText({ company, title, location, extra, text }: { company?: string; title?: string; location?: string; extra?: string; text?: string }) {
  return [
    company ? `Company: ${company}` : "",
    title && !isGenericTitle(title) ? `Title: ${title}` : "",
    location ? `Location: ${location}` : "",
    extra ? `Type: ${extra}` : "",
    "",
    text || "",
  ].filter((line, index, all) => line || (index > 0 && all[index - 1])).join("\n").trim();
}

export function usable(text: string, trusted: boolean) {
  if (trusted) return String(text || "").trim().split(/\s+/).filter(Boolean).length >= 40;
  // Page text is judged without menus, cookie notices, EEO and benefits text, so a page made only of
  // those (an error page, a careers home page) is not mistaken for a job description.
  const core = removeBoilerplate(String(text || ""), false);
  const words = core.split(/\s+/).filter(Boolean).length;
  return (words >= 100 && JOB_SIGNAL.test(core)) || words >= 400;
}

export function looksBlocked(html: string) {
  const text = html.replace(/\s+/g, " ").slice(0, 4000);
  return html.length < 20000 && BLOCKED.test(text);
}

// Bot walls are short pages. Full job pages often mention reCAPTCHA in a footer, which is not a block.
export function looksBlockedText(text: string) {
  return BLOCKED.test(text.slice(0, 4000)) && text.trim().split(/\s+/).length < 250;
}

export function ok(result: Omit<FetchResult, "ok" | "error">): FetchResult {
  return { ok: true, error: "", ...result, text: result.text.slice(0, 20000) };
}

export function fail(url: string, error: string): FetchResult {
  return { ok: false, url, company: "", title: "", location: "", text: "", source: "", error };
}

// True when the original link names a job ID (a long number or a UUID) that the final page of the same
// site no longer has in its address.
export function lostJobId(original: string, final: string) {
  if (!/^https?:/i.test(final) || hostOf(original) !== hostOf(final)) return false;
  const ids = new URL(original).pathname.match(/\d{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  if (!ids.length) return false;
  const landing = decodeURIComponent(new URL(final).pathname + new URL(final).search).toLowerCase();
  return !ids.some((id) => landing.includes(id.toLowerCase()));
}

export function hostOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// A failure that no other read method can fix.
export function stop(url: string, error: string): FetchResult {
  return { ...fail(url, error), final: true };
}

export function titleCase(value: string) {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
