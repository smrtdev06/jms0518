import { fillPrompt, readPrompt } from "./prompt-source";

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
  const [systemRaw, userRaw] = await Promise.all([
    readPrompt("ANSWERS_PROMPT_SYSTEM", DEFAULT_FILES.ANSWERS_PROMPT_SYSTEM),
    readPrompt("ANSWERS_PROMPT_USER", DEFAULT_FILES.ANSWERS_PROMPT_USER),
  ]);
  return { system: fillPrompt(systemRaw, values), user: fillPrompt(userRaw, values) };
}
