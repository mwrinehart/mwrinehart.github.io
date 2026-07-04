// Shared Anthropic Claude client (dependency-free; calls the Messages API over
// fetch). Horizon used Claude for finding summaries + RAG chat; Make uses it for
// course/content assists. Both route through here so model choice, keys, and
// cost controls live in one place. Per-org API keys (from encrypted secrets)
// can override the platform key later via the `apiKey` option.

import { str } from "./env";
import { getOrgSecret } from "./secrets";

const API_URL = "https://api.anthropic.com/v1/messages";

// The Anthropic key to use for an org: its own encrypted secret if set, else the
// platform-wide env key. Returns null when neither is configured (callers skip).
export async function orgAnthropicKey(orgId: string): Promise<string | null> {
  return (await getOrgSecret(orgId, "anthropicApiKey")) || str("ANTHROPIC_API_KEY");
}
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

// Lenient JSON extraction for AI output that was asked for STRICT JSON but may
// still arrive wrapped in prose or code fences. Returns the parsed object, or
// null on garbage — callers validate field types before persisting anything.
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
