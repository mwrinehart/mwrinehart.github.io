// Shared Anthropic Claude client (dependency-free; calls the Messages API over
// fetch). Horizon used Claude for finding summaries + RAG chat; Make uses it for
// course/content assists. Both route through here so model choice, keys, and
// cost controls live in one place. Per-org API keys (from encrypted secrets)
// can override the platform key later via the `apiKey` option.

import { str } from "./env";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = str("ANTHROPIC_MODEL") || "claude-sonnet-4-6";

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  model?: string;
  apiKey?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export async function complete(messages: Message[], opts: CompleteOptions = {}): Promise<string> {
  const apiKey = opts.apiKey ?? str("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured.");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages,
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

// Convenience used by Compliance findings + Behavior pulse: one-shot summarize +
// recommended actions for a piece of content.
export async function summarize(text: string, context?: string): Promise<string> {
  return complete([{ role: "user", content: text }], {
    system:
      "You are a security & compliance analyst. Summarize the item in 2-3 sentences, then list concrete recommended actions as bullet points." +
      (context ? `\n\nOrganization context:\n${context}` : ""),
    maxTokens: 600,
  });
}
