export type ExperienceInput = {
  jobTitle: string;
  companyName: string;
  companyAddress: string;
  startDate: string;
  endDate: string;
};

export type EducationInput = {
  universityName: string;
  universityLocation: string;
  startDate: string;
  endDate: string;
  degree: string;
};

export type Experience = ExperienceInput & { bulletCount: number };
export type Education = EducationInput;

export type Profile = {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  linkedin: string;
  experiences: Experience[];
  education: Education[];
  baseResumeText: string;
};

export type PublicProfile = {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  linkedin: string;
  headline: string;
  experiences: Experience[];
  education: Education[];
};

export type JobStatus = "queued" | "running" | "needs_manual" | "done" | "failed" | "skipped";
export type JobStep = "scrape" | "fetch" | "extract" | "generate" | "validate" | "zip";

export type JobLog = {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type JobRecord = {
  id: number;
  position: number;
  url: string;
  status: JobStatus;
  step: JobStep | null;
  message: string;
  company: string;
  jobTitle: string;
  error: string;
  atsScore: number | null;
  usage: { prompt: number; completion: number; total: number; cached: number } | null;
  logs: JobLog[];
  zipName: string;
  resumeName: string;
  coverName: string;
};

export type Bullet = { text: string; boldPhrases: string[] };

export type GeneratedContent = {
  company: string;
  jobTitle: string;
  summary: string[];
  // Phrases the model bolded in the summary, drawn bold like the template's key terms.
  summaryBold?: string[];
  skills: { category: string; items: string[] }[];
  roles: { overview: string; bullets: Bullet[] }[];
  coverLetter: string[];
  ats: { matchedKeywords: string[]; missingKeywords: string[] };
};
