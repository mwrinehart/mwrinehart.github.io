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
