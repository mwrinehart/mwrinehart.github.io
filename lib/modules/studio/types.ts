// Course authoring document model. A course is an ordered list of typed blocks;
// the whole doc is stored as JSON in studio_projects.data.

export type Block =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "bullets"; items: string[] }
  | { id: string; type: "quiz"; question: string; options: string[]; answer: number }
  | { id: string; type: "image"; prompt: string; url?: string }
  | { id: string; type: "divider" };

export type BlockType = Block["type"];

export const BLOCK_TYPES: BlockType[] = ["heading", "text", "bullets", "quiz", "image", "divider"];

export interface CourseDoc {
  blocks: Block[];
}

export function emptyDoc(): CourseDoc {
  return { blocks: [] };
}

export function newBlock(id: string, type: BlockType): Block {
  switch (type) {
    case "heading":
      return { id, type, text: "New section" };
    case "text":
      return { id, type, text: "" };
    case "bullets":
      return { id, type, items: [] };
    case "quiz":
      return { id, type, question: "", options: ["", ""], answer: 0 };
    case "image":
      return { id, type, prompt: "" };
    case "divider":
      return { id, type };
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// Repair an untrusted block object (from persisted JSON or a merged form update)
// into a valid Block, dropping anything we can't make sense of. This is the single
// gate everything stored/rendered passes through — keep it total over its input.
// (No crypto import here: this module is client-importable; a random id suffix is
// fine as a fallback when a block somehow lacks one.)
export function coerceBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (typeof type !== "string" || !(BLOCK_TYPES as string[]).includes(type)) return null;
  const id = typeof r.id === "string" && r.id ? r.id : `blk-${Math.random().toString(36).slice(2)}`;
  switch (type as BlockType) {
    case "heading":
      return { id, type: "heading", text: str(r.text) };
    case "text":
      return { id, type: "text", text: str(r.text) };
    case "bullets":
      return { id, type: "bullets", items: strArray(r.items) };
    case "quiz": {
      const options = strArray(r.options);
      const rawAns = Math.trunc(Number(r.answer));
      const answer = options.length && Number.isFinite(rawAns) ? Math.max(0, Math.min(options.length - 1, rawAns)) : 0;
      return { id, type: "quiz", question: str(r.question), options, answer };
    }
    case "image": {
      const url = typeof r.url === "string" ? r.url : undefined;
      return { id, type: "image", prompt: str(r.prompt), ...(url ? { url } : {}) };
    }
    case "divider":
      return { id, type: "divider" };
  }
}
