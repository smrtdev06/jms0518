import fs from "node:fs/promises";
import path from "node:path";
import { formatRunDate, yearsOfExperience } from "./base-resume";
import { rootDir } from "./paths";
import type { TargetJob } from "./target-job";
import type { Experience, Profile } from "./types";

// Reads the two prompts on every call, then fills the placeholders for one job. Each prompt is the text in
// PROMPT_SYSTEM_TEXT / PROMPT_USER_TEXT when set (for hosts without the prompts/ folder), otherwise the file
// named by PROMPT_SYSTEM / PROMPT_USER.
export async function loadTailorPrompts(profile: Profile, target: TargetJob, today = new Date()) {
  const [systemRaw, userRaw] = await Promise.all([readPrompt("PROMPT_SYSTEM"), readPrompt("PROMPT_USER")]);
  const values: Record<string, string> = {
    today: formatRunDate(today),
    yearsOfExperience: String(yearsOfExperience(profile.experiences, today)),
    jobTitle: target.jobTitle,
    jobStack: target.jobStack,
    companyName: target.companyName,
    companyUrl: target.companyUrl,
    jobDescription: target.jobDescription,
    baseResumeText: profile.baseResumeText,
    bulletPlan: bulletPlan(profile.experiences),
  };
  return { system: fill(systemRaw, values), user: fill(userRaw, values) };
}

// "- Software Engineer at Acme (Jan 2020 – Present): 6 bullets", one line per role in resume order.
function bulletPlan(experiences: Experience[]) {
  return experiences
    .map((job) => `- ${job.jobTitle} at ${job.companyName} (${job.startDate} – ${job.endDate}): ${job.bulletCount} bullets`)
    .join("\n");
}

async function readPrompt(name: "PROMPT_SYSTEM" | "PROMPT_USER") {
  const text = process.env[`${name}_TEXT`];
  // "base64:..." carries the text with its line breaks intact through hosting dashboards.
  if (text?.trim()) return text.startsWith("base64:") ? Buffer.from(text.slice(7).trim(), "base64").toString("utf8") : text;
  const given = process.env[name]?.trim();
  if (!given) throw new Error(`Set ${name} (a prompt file) or ${name}_TEXT (the prompt itself) in the environment.`);
  return fs.readFile(path.isAbsolute(given) ? given : path.join(rootDir, given), "utf8");
}

function fill(text: string, values: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? values[key] : match));
}
