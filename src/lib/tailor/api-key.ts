// The AI service that writes the resume and cover letter. LLM_PROVIDER picks it (default "openai").
// DeepSeek accepts the same chat-completions requests as OpenAI at its own address.
type Provider = {
  name: "OpenAI" | "DeepSeek";
  keyName: string;
  apiKey: string;
  baseURL?: string;
  // The first model is tried first; the later ones only when it is not available.
  models: string[];
  // Room for the reply. For thinking models it also holds the thinking, which counts toward the reply.
  maxTokens: number;
  // Extra request fields, such as DeepSeek's thinking effort.
  extra?: Record<string, string>;
};

export function readProvider(): Provider {
  if (/^deepseek$/i.test(process.env.LLM_PROVIDER?.trim() || "")) {
    // none, low, high or max. The model's hidden thinking is billed as reply tokens: on one resume, none used about
    // 5,600 tokens, low about 9,800 and DeepSeek's own default (high) about 15,400, with the same quality. So none unless set.
    const effort = process.env.DEEPSEEK_REASONING_EFFORT?.trim().toLowerCase() || "none";
    return {
      name: "DeepSeek",
      keyName: "DEEPSEEK_API_KEY",
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() || "",
      baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
      models: [process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash"],
      // DeepSeek V4 models think before answering, and the thinking counts toward this limit.
      maxTokens: 32000,
      extra: effort ? { reasoning_effort: effort } : undefined,
    };
  }
  return {
    name: "OpenAI",
    keyName: "OPENAI_API_KEY",
    apiKey: process.env.OPENAI_API_KEY?.trim() || "",
    models: [...new Set([process.env.OPENAI_MODEL?.trim(), "gpt-4.1", "gpt-4o", "gpt-4o-mini"].filter((item): item is string => Boolean(item)))],
    maxTokens: 16000,
  };
}

export function scrub(message: string) {
  return String(message || "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-…");
}
