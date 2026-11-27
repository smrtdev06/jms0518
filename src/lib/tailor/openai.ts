import OpenAI from "openai";
import { readProvider, scrub } from "./api-key";
import { parseTailoredApplication, type TailoredApplication } from "./tailored-markdown";
import type { Experience } from "./types";

export type ChatOptions = { apiKey: string; system: string; user: string; signal?: AbortSignal };

// What to do with one reply: keep it, or ask again with the reason (a cut-off, empty or incomplete reply).
type ReadReply<T> = (text: string) => { ok: true; value: T } | { ok: false; error: string };

/**
 * One chat-completions request (OpenAI or DeepSeek, per LLM_PROVIDER). Each model is tried twice; a model that is
 * not available moves on to the next one. A reply that is still unusable after the second try stops with `retryHint`.
 */
export async function complete<T>(
  options: ChatOptions & {
    declined: string;
    retryHint: string;
    read: ReadReply<T>;
    /** ask for a JSON object reply (response_format json_object; the prompt must mention JSON) */
    json?: boolean;
    temperature?: number;
    /** room for the reply (default: the provider's) */
    maxTokens?: number;
    /** a smaller retry budget than tailoring's, for many short requests */
    maxRetries?: number;
  },
) {
  const provider = readProvider();
  const service = provider.name;
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: provider.baseURL, timeout: 180000, maxRetries: options.maxRetries ?? 6 });
  let usage: Usage | null = null;
  let lastError = `No ${service} model was available for this API key.`;
  for (const model of provider.models) {
    let badReply = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.chat.completions.create(
          {
            model,
            temperature: options.temperature ?? 0.4,
            max_tokens: options.maxTokens ?? (provider.name === "OpenAI" ? (attempt ? 16000 : 12000) : provider.maxTokens),
            ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
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
        if (refusal) throw new GenerationError(scrub(`${service} declined to ${options.declined}: ${refusal}`).slice(0, 300), usage);
        if (choice?.finish_reason === "length") {
          badReply = true;
          lastError = `${service}'s reply was cut off before it finished.`;
          continue;
        }
        const reply = options.read(choice?.message?.content || "");
        if (!reply.ok) {
          badReply = true;
          lastError = `${service}${reply.error}`;
          continue;
        }
        return { value: reply.value, usage, model: response.model || model };
      } catch (error) {
        if (error instanceof GenerationError) throw error;
        if (options.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : "";
        const status = (error as { status?: number }).status;
        if (status === 404 || (/model/i.test(message) && /not found|does not exist|access|unavailable/i.test(message))) {
          badReply = false;
          lastError = message;
          break;
        }
        throw new GenerationError(scrub(message || `${service} request failed.`), usage);
      }
    }
    if (badReply) throw new GenerationError(`${lastError} ${options.retryHint}`, usage);
  }
  throw new GenerationError(scrub(lastError), usage);
}

// Screening answers use the same model as tailoring. The reply is returned as written.
export async function generateAnswers(options: ChatOptions) {
  const result = await complete({
    ...options,
    declined: "answer these questions",
    retryHint: "Try these questions again.",
    read: (text) => (text.trim() ? { ok: true, value: text.trim() } : { ok: false, error: " returned an empty answer." }),
  });
  return { text: result.value, model: result.model };
}

export async function generateApplication(options: ChatOptions & { experiences: Experience[]; fullName: string }) {
  const result = await complete({
    ...options,
    declined: "write this application",
    retryHint: "Try this link again.",
    read: (text) =>
      /^#\s*RESUME\b/im.test(text) && /^#\s*COVER LETTER\b/im.test(text)
        ? { ok: true, value: { ...parseTailoredApplication(text, options.experiences, options.fullName), raw: text } }
        : { ok: false, error: "'s reply did not include a resume and a cover letter." },
  });
  return { ...result.value, usage: result.usage, model: result.model } satisfies TailoredApplication & { raw: string; usage: Usage | null; model: string };
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
