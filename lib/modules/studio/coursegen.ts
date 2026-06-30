// AI course generation (rebuilt from Make's course-gen). Turns a topic into a
// structured course doc via the shared Anthropic client, then saves it onto the
// project. Output is validated/normalized so a malformed model response can't
// corrupt the authoring doc.

import { randomUUID } from "crypto";
import { complete, orgAnthropicKey } from "@/lib/platform/ai";
import { getProject, saveDoc } from "./projects";
import { BLOCK_TYPES, type Block, type BlockType, type CourseDoc } from "./types";

const SYSTEM =
  "You are an instructional designer. Produce a concise eLearning course as STRICT JSON only (no prose, no code fences): " +
  '{"blocks":[ ... ]} where each block is one of: ' +
  '{"type":"heading","text":string}, {"type":"text","text":string}, ' +
  '{"type":"bullets","items":string[]}, ' +
  '{"type":"quiz","question":string,"options":string[],"answer":number(index)}, ' +
  '{"type":"image","prompt":string}, {"type":"divider"}. ' +
  "Aim for 8-16 blocks: an intro, a few sections with text/bullets, an image prompt or two, and 1-3 quiz checks.";

function normalizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as BlockType;
  if (!BLOCK_TYPES.includes(type)) return null;
  const id = randomUUID();
  switch (type) {
    case "heading":
    case "text":
      return typeof r.text === "string" ? { id, type, text: r.text } : null;
    case "bullets":
      return Array.isArray(r.items) ? { id, type, items: r.items.filter((x) => typeof x === "string") } : null;
    case "quiz": {
      const options = Array.isArray(r.options) ? r.options.filter((x) => typeof x === "string") : [];
      if (typeof r.question !== "string" || options.length < 2) return null;
      const answer = typeof r.answer === "number" && r.answer >= 0 && r.answer < options.length ? r.answer : 0;
      return { id, type, question: r.question, options, answer };
    }
    case "image":
      return { id, type, prompt: typeof r.prompt === "string" ? r.prompt : "" };
    case "divider":
      return { id, type };
  }
}

function parseCourse(raw: string): CourseDoc | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const data = JSON.parse(match ? match[0] : raw) as { blocks?: unknown[] };
    if (!Array.isArray(data.blocks)) return null;
    const blocks = data.blocks.map(normalizeBlock).filter((b): b is Block => b !== null);
    return blocks.length ? { blocks } : null;
  } catch {
    return null;
  }
}

export async function generateCourse(orgId: string, projectId: string, topic: string): Promise<void> {
  const project = await getProject(orgId, projectId);
  if (!project) throw new Error("Project not found");
  const apiKey = await orgAnthropicKey(orgId);
  if (!apiKey) throw new Error("No Anthropic API key configured for this org or platform.");

  const out = await complete([{ role: "user", content: `Course topic: ${topic || project.title}` }], {
    system: SYSTEM,
    maxTokens: 1800,
    apiKey,
  });
  const doc = parseCourse(out);
  if (!doc) throw new Error("AI returned an unparseable course");
  await saveDoc(orgId, projectId, doc);
}
