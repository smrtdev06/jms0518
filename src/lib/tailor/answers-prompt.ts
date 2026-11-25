import fs from "node:fs/promises";
import path from "node:path";
import { rootDir } from "./paths";

const DEFAULT_FILES = {
  ANSWERS_PROMPT_SYSTEM: "./prompts/DEFAULT_ANSWERS_PROMPT_SYSTEM.md",
  ANSWERS_PROMPT_USER: "./prompts/DEFAULT_ANSWERS_PROMPT_USER.md",
} as const;

export type AnswerPromptValues = {
  jobTitle: string;
  jobStack: string;
  companyName: string;
  companyUrl: string;
  jobDescription: string;
  generatedResumeMarkdown: string;
  generatedCoverLetterMarkdown: string;
  baseResumeText: string;
  questions: string;
};

// Reads the screening prompts (env text, env file, or the defaults in prompts/) and fills the user template.
export async function loadAnswerPrompts(values: AnswerPromptValues) {
  const [systemRaw, userRaw] = await Promise.all([readPrompt("ANSWERS_PROMPT_SYSTEM"), readPrompt("ANSWERS_PROMPT_USER")]);
  return { system: fill(systemRaw, values), user: fill(userRaw, values) };
}

async function readPrompt(name: keyof typeof DEFAULT_FILES) {
  const text = process.env[`${name}_TEXT`];
  if (text?.trim()) return text.startsWith("base64:") ? Buffer.from(text.slice(7).trim(), "base64").toString("utf8") : text;
  const given = process.env[name]?.trim() || DEFAULT_FILES[name];
  return fs.readFile(path.isAbsolute(given) ? given : path.join(rootDir, given), "utf8");
}

function fill(text: string, values: AnswerPromptValues) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? values[key as keyof AnswerPromptValues] : match));
}
