import OpenAI from "openai";
import { readProvider, scrub } from "./api-key";
import { parseTailoredApplication, type TailoredApplication } from "./tailored-markdown";
import type { Experience } from "./types";

// Screening answers use the same model as tailoring. The reply is returned as written.
export async function generateAnswers(options: { apiKey: string; system: string; user: string; signal?: AbortSignal }) {
  const provider = readProvider();
  const service = provider.name;
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: provider.baseURL, timeout: 180000, maxRetries: 6 });
  let lastError = `No ${service} model was available for this API key.`;
  for (const model of provider.models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.chat.completions.create(
          {
            model,
            temperature: 0.4,
            max_tokens: provider.name === "OpenAI" ? (attempt ? 16000 : 12000) : provider.maxTokens,
            messages: [
              { role: "system", content: options.system },
              { role: "user", content: options.user },
            ],
            ...provider.extra,
          },
          { signal: options.signal },
        );
        const choice = response.choices[0];
        const refusal = (choice?.message as { refusal?: string | null } | undefined)?.refusal;
        if (refusal) throw new GenerationError(scrub(`${service} declined to answer these questions: ${refusal}`).slice(0, 300), null);
        if (choice?.finish_reason === "length") {
          lastError = `${service}'s reply was cut off before it finished.`;
          continue;
        }
        const text = (choice?.message?.content || "").trim();
        if (!text) {
          lastError = `${service} returned an empty answer.`;
          continue;
        }
        return { text, model: response.model || model };
      } catch (error) {
        if (error instanceof GenerationError) throw error;
        if (options.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : "";
        const status = (error as { status?: number }).status;
        if (status === 404 || (/model/i.test(message) && /not found|does not exist|access|unavailable/i.test(message))) {
          lastError = message;
          break;
        }
        throw new GenerationError(scrub(message || `${service} request failed.`), null);
      }
    }
    if (lastError.startsWith(`${service}'s reply`) || lastError.startsWith(`${service} returned`)) {
      throw new GenerationError(`${lastError} Try these questions again.`, null);
    }
  }
  throw new GenerationError(scrub(lastError), null);
}

export async function generateApplication(options: {
  apiKey: string;
  system: string;
  user: string;
  experiences: Experience[];
  fullName: string;
  signal?: AbortSignal;
}) {
  // OpenAI or DeepSeek (LLM_PROVIDER); both take the same chat-completions request.
  const provider = readProvider();
  const service = provider.name;
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: provider.baseURL, timeout: 180000, maxRetries: 6 });
  let usage: Usage | null = null;
  let lastError = `No ${service} model was available for this API key.`;
  for (const model of provider.models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.chat.completions.create(
          {
            model,
            temperature: 0.4,
            max_tokens: provider.name === "OpenAI" ? (attempt ? 16000 : 12000) : provider.maxTokens,
            messages: [
              { role: "system", content: options.system },
              { role: "user", content: options.user },
            ],
            ...provider.extra,
          },
          { signal: options.signal },
        );
        usage = addUsage(usage, readUsage(response.usage));
        const choice = response.choices[0];
        const refusal = (choice?.message as { refusal?: string | null } | undefined)?.refusal;
        if (refusal) throw new GenerationError(scrub(`${service} declined to write this application: ${refusal}`).slice(0, 300), usage);
        if (choice?.finish_reason === "length") {
          lastError = `${service}'s reply was cut off before it finished.`;
          continue;
        }
        const text = choice?.message?.content || "";
        if (!/^#\s*RESUME\b/im.test(text) || !/^#\s*COVER LETTER\b/im.test(text)) {
          lastError = `${service}'s reply did not include a resume and a cover letter.`;
          continue;
        }
        const tailored = parseTailoredApplication(text, options.experiences, options.fullName);
        return { ...tailored, raw: text, usage, model: response.model || model } satisfies TailoredApplication & { raw: string; usage: Usage | null; model: string };
      } catch (error) {
        if (error instanceof GenerationError) throw error;
        if (options.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : "";
        const status = (error as { status?: number }).status;
        if (status === 404 || (/model/i.test(message) && /not found|does not exist|access|unavailable/i.test(message))) {
          lastError = message;
          break;
        }
        throw new GenerationError(scrub(message || `${service} request failed.`), usage);
      }
    }
    if (lastError.startsWith(`${service}'s reply`)) throw new GenerationError(`${lastError} Try this link again.`, usage);
  }
  throw new GenerationError(scrub(lastError), usage);
}

export type Usage = { prompt: number; completion: number; total: number; cached: number };

export class GenerationError extends Error {
  usage: Usage | null;

  constructor(message: string, usage: Usage | null) {
    super(message);
    this.usage = usage;
  }
}

export function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return { prompt: a.prompt + b.prompt, completion: a.completion + b.completion, total: a.total + b.total, cached: a.cached + b.cached };
}

// DeepSeek reports its cache hits as prompt_cache_hit_tokens instead of prompt_tokens_details.cached_tokens.
function readUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null; prompt_cache_hit_tokens?: number } | null | undefined) {
  const prompt = usage?.prompt_tokens || 0;
  const completion = usage?.completion_tokens || 0;
  const total = usage?.total_tokens || prompt + completion;
  if (!total) return null;
  return { prompt, completion, total, cached: usage?.prompt_tokens_details?.cached_tokens || usage?.prompt_cache_hit_tokens || 0 };
}
