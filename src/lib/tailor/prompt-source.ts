import fs from "node:fs/promises";
import path from "node:path";
import { rootDir } from "./paths.ts";

// The prompts sent to the AI (tailoring, screening answers, email analysis) are read the same way:
//   <NAME>_TEXT  the prompt itself; "base64:..." keeps its line breaks intact through hosting dashboards,
//   <NAME>       a prompt file (relative to the project folder),
//   otherwise    the default file in prompts/, when there is one.
// Each is read on every use, so an edited prompt applies without a restart.

export async function readPrompt(name: string, defaultFile?: string) {
  const text = process.env[`${name}_TEXT`];
  if (text?.trim()) return text.startsWith("base64:") ? Buffer.from(text.slice(7).trim(), "base64").toString("utf8") : text;
  const given = process.env[name]?.trim() || defaultFile;
  if (!given) throw new Error(`Set ${name} (a prompt file) or ${name}_TEXT (the prompt itself) in the environment.`);
  return fs.readFile(path.isAbsolute(given) ? given : path.join(rootDir, given), "utf8");
}

/** Fills {{name}} placeholders in one pass, so text inside a value that looks like a placeholder stays as it is. */
export function fillPrompt(text: string, values: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (Object.hasOwn(values, name) ? values[name] : match));
}
