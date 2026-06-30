// AI course generation (rebuilt from Make's course-gen). Turns a topic into a
// structured course doc via the shared Anthropic client, then saves it onto the
// project. Output is validated/normalized so a malformed model response can't
// corrupt the authoring doc.

import { complete, orgAnthropicKey } from "@/lib/platform/ai";
import { getProject, saveDoc } from "./projects";
import { coerceBlock, type Block, type CourseDoc } from "./types";

const SYSTEM =
  "You are an instructional designer. Produce a concise eLearning course as STRICT JSON only (no prose, no code fences): " +
  '{"blocks":[ ... ]} where each block is one of: ' +
  '{"type":"heading","text":string}, {"type":"text","text":string}, ' +
  '{"type":"bullets","items":string[]}, ' +
  '{"type":"quiz","question":string,"options":string[],"answer":number(index)}, ' +
  '{"type":"image","prompt":string}, {"type":"divider"}. ' +
  "Aim for 8-16 blocks: an intro, a few sections with text/bullets, an image prompt or two, and 1-3 quiz checks.";

function parseCourse(raw: string): CourseDoc | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const data = JSON.parse(match ? match[0] : raw) as { blocks?: unknown[] };
    if (!Array.isArray(data.blocks)) return null;
    // Route AI output through the SAME repair gate as everything else
    // (coerceBlock), then apply one AI-specific strictness rule: drop quizzes
    // that don't offer at least two options.
    const blocks = data.blocks
      .map(coerceBlock)
      .filter((b): b is Block => b !== null)
      .filter((b) => b.type !== "quiz" || b.options.length >= 2);
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
  // CAS on the updatedAt we read before the (multi-second) AI call: if the user
  // edited the course meanwhile, their edits win and we surface a retry rather
  // than silently discarding them.
  const saved = await saveDoc(orgId, projectId, doc, project.updatedAt);
  if (!saved) throw new Error("Course was edited during generation; please re-run.");
}
