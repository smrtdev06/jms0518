// The AI's reading of one email (prompts/DEFAULT_PROMPT_ANALYZE_EMAIL.md): parsing and checking its JSON reply.
// No I/O, so it is unit tested.

const CATEGORIES = [
  "interview_scheduling",
  "application_received",
  "rejection",
  "offer",
  "assessment",
  "job_alert",
  "recruiter_outreach",
  "application_update",
  "other",
] as const;

export type EmailAnalysis = {
  category: (typeof CATEGORIES)[number];
  is_interview_scheduling: boolean;
  interview_scheduling_confidence: number;
  company_name: string;
  job_title: string;
  job_reference: string;
  sender_role: string;
  interview_type: string;
  proposed_times: string[];
  scheduling_link: string;
  summary: string;
};

/** Below this confidence an email is not treated as an interview request, whatever the flag says. */
const MIN_CONFIDENCE = 60;

const text = (value: unknown, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Reads the reply (a JSON object, possibly inside a code fence or with text around it), or null when it is not one. */
export function parseAnalysis(reply: string): EmailAnalysis | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const category = CATEGORIES.includes(raw.category as EmailAnalysis["category"]) ? (raw.category as EmailAnalysis["category"]) : "other";
  const flag = raw.is_interview_scheduling === true || raw.is_interview_scheduling === "true";
  const confidence = Math.max(0, Math.min(100, Math.round(Number(raw.interview_scheduling_confidence) || 0)));
  return {
    category,
    is_interview_scheduling: flag,
    // A reply without a confidence counts as fairly sure of its flag.
    interview_scheduling_confidence: raw.interview_scheduling_confidence === undefined ? (flag ? 70 : 0) : confidence,
    company_name: text(raw.company_name, 200),
    job_title: text(raw.job_title, 200),
    job_reference: text(raw.job_reference, 300),
    sender_role: text(raw.sender_role, 40),
    interview_type: text(raw.interview_type, 80),
    proposed_times: Array.isArray(raw.proposed_times) ? raw.proposed_times.map((t) => text(t, 120)).filter(Boolean).slice(0, 10) : [],
    scheduling_link: text(raw.scheduling_link, 1000),
    summary: text(raw.summary, 500),
  };
}

/** Only interview scheduling emails are kept; everything else is skipped. */
export function isInterviewRequest(analysis: EmailAnalysis) {
  return analysis.is_interview_scheduling && analysis.interview_scheduling_confidence >= MIN_CONFIDENCE;
}
