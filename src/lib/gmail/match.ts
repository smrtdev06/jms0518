import { normalizeCompany } from "../normalize.ts";

// Finds which of the profile's jobs an interview email is about, from the company and job title the AI read in it,
// the sender's address and the job links. No I/O, so it is unit tested.

export type CandidateJob = {
  id: number;
  company_name: string;
  job_title: string;
  job_link: string;
  apply_status: string;
  applied_at: string | Date | null;
};

export type EmailClues = {
  companyName: string;
  jobTitle: string;
  jobReference?: string;
  fromEmail: string;
};

export type JobMatch = { job: CandidateJob; score: number; reason: string };

// Sender domains that belong to email services, job boards, applicant-tracking and scheduling tools, not employers.
const SHARED_DOMAINS = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "icloud", "aol", "protonmail", "proton", "google",
  "linkedin", "indeed", "indeedemail", "glassdoor", "ziprecruiter", "dice", "monster", "wellfound", "angel", "builtin",
  "myworkday", "myworkdayjobs", "workday", "greenhouse", "greenhousemail", "lever", "hire", "icims", "ashbyhq", "ashby",
  "smartrecruiters", "jobvite", "workable", "workablemail", "bamboohr", "breezy", "jazzhr", "applytojob", "recruitee",
  "teamtailor", "successfactors", "taleo", "oracle", "oraclecloud", "paylocity", "paycomonline", "paycom", "adp",
  "ultipro", "ukg", "dayforce", "ceridian", "rippling", "gusto", "personio", "pinpointhq", "trinethire", "hirebridge",
  "calendly", "goodtime", "zoom", "teams", "microsoft", "doodle", "cal", "hubspot", "sendgrid", "mailchimp", "mandrillapp",
  "amazonses", "mailgun", "sparkpost", "notifications", "email", "mail", "jobs", "careers", "recruiting", "talent", "hr",
]);

// Company names that say nothing (the AI's or the page's placeholder when the real name was not found).
const GENERIC_COMPANIES = new Set(["", "company", "the company", "unknown", "confidential", "n a", "na", "employer", "hiring company"]);

const TITLE_STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "in", "at", "with", "remote", "hybrid", "onsite", "us", "usa", "position", "role", "job"]);

function compact(text: string) {
  return text.replace(/[^a-z0-9]/g, "");
}

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/\b(sr|snr)\b\.?/g, "senior")
    .replace(/\b(jr)\b\.?/g, "junior")
    .replace(/\b(eng)\b\.?/g, "engineer")
    .replace(/\b(swe|sde)\b/g, "software engineer")
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w && !TITLE_STOP.has(w));
}

function overlap(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = new Set(a.filter((w) => setB.has(w))).size;
  return shared / Math.min(new Set(a).size, setB.size);
}

/** The employer-looking labels of the sender's domain: "jane@talent.acme-corp.com" → ["acme-corp" → "acmecorp"]. */
export function senderLabels(fromEmail: string) {
  const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
  const labels = domain.split(".").slice(0, -1); // drop the top-level domain
  return labels.map((label) => label.replace(/[^a-z0-9]/g, "")).filter((label) => label.length >= 3 && !SHARED_DOMAINS.has(label));
}

/** The employer part of a job link's host or path: recar.wd108.myworkdayjobs.com → "recar"; jobs.lever.co/acme → "acme". */
export function linkLabels(link: string) {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const labels = host.split(".").slice(0, -1).map((l) => l.replace(/[^a-z0-9]/g, ""));
    const first = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
    // Boards that put the company in the path.
    if (/(greenhouse|lever|ashbyhq|smartrecruiters|workable|jobvite|recruitee|breezy|pinpointhq)\./.test(host) && first) labels.push(first);
    return labels.filter((label) => label.length >= 3 && !SHARED_DOMAINS.has(label) && !/^wd\d+$/.test(label));
  } catch {
    return [];
  }
}

/** How well a job's company fits the email: 0 (not at all) to 100 (same name). */
function companyScore(job: CandidateJob, clues: EmailClues) {
  const jobKey = normalizeCompany(job.company_name);
  const emailKey = normalizeCompany(clues.companyName);
  let score = 0;
  let reason = "";
  if (!GENERIC_COMPANIES.has(jobKey) && !GENERIC_COMPANIES.has(emailKey)) {
    if (jobKey === emailKey || compact(jobKey) === compact(emailKey)) {
      score = 100;
      reason = "same company name";
    } else {
      const [shorter, longer] = jobKey.length <= emailKey.length ? [jobKey, emailKey] : [emailKey, jobKey];
      if (shorter.length >= 3 && new RegExp(`(^| )${shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(longer)) {
        score = 85;
        reason = "company name contains the other";
      } else {
        const share = overlap(jobKey.split(" "), emailKey.split(" "));
        if (share >= 0.5) {
          score = Math.round(60 * share);
          reason = "company names share words";
        }
      }
    }
  }
  // The sender's own domain (not an ATS or job board) names the employer: talent@recar.com for Re:Car, Inc.
  const jobCompact = compact(jobKey);
  const fromLabels = senderLabels(clues.fromEmail);
  const domainHit =
    (jobCompact.length >= 3 && fromLabels.some((label) => label === jobCompact || (label.length >= 4 && (label.startsWith(jobCompact) || jobCompact.startsWith(label))))) ||
    fromLabels.some((label) => linkLabels(job.job_link).includes(label));
  if (domainHit && score < 90) {
    score = 90;
    reason = "the sender's domain is the company's";
  }
  // The email's company name is the employer's part of the job link: "FICO" for fico.wd1.myworkdayjobs.com, when the
  // job itself says "Fair Isaac Corporation".
  const emailCompact = compact(emailKey);
  if (score < 85 && emailCompact.length >= 3 && !GENERIC_COMPANIES.has(emailKey) && linkLabels(job.job_link).includes(emailCompact)) {
    score = 85;
    reason = "the company name is in the job link";
  }
  return { score, reason };
}

/** How well a job's title fits the email's job title: 0 to 1. */
function titleScore(job: CandidateJob, clues: EmailClues) {
  const target = words(clues.jobTitle || "");
  if (!target.length) return 0;
  return overlap(words(job.job_title), target);
}

/**
 * The job this email is about, or null. The company must fit (name or sender domain); among the company's jobs the
 * title, an applied status, a job reference in the link, and the newest application decide.
 */
export function matchJob(jobs: CandidateJob[], clues: EmailClues): JobMatch | null {
  let best: JobMatch | null = null;
  let bestRank = -1;
  for (const job of jobs) {
    const company = companyScore(job, clues);
    const reference = clues.jobReference?.trim().toLowerCase();
    const referenceHit = Boolean(reference && reference.length >= 4 && job.job_link.toLowerCase().includes(reference));
    if (company.score < 50 && !referenceHit) continue;
    const title = titleScore(job, clues);
    const score = Math.min(100, Math.round(company.score * 0.7 + title * 30 + (referenceHit ? 30 : 0)));
    const applied = job.apply_status === "applied" ? 1 : 0;
    const time = job.applied_at ? new Date(job.applied_at).getTime() / 1e13 : 0; // < 1: only breaks ties
    const rank = score + applied * 5 + time;
    if (rank > bestRank) {
      bestRank = rank;
      const reasons = [company.reason, title >= 0.5 ? "the job title fits" : "", referenceHit ? "the job reference is in the link" : ""].filter(Boolean);
      best = { job, score, reason: reasons.join(", ") };
    }
  }
  return best;
}
