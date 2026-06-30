import { describe, expect, it } from "vitest";
import { coerceBlock, newBlock, type Block } from "./types";

describe("coerceBlock", () => {
  it("rejects non-objects and unknown types", () => {
    expect(coerceBlock(null)).toBeNull();
    expect(coerceBlock("nope")).toBeNull();
    expect(coerceBlock({ type: "marquee", text: "x" })).toBeNull();
    expect(coerceBlock({ text: "no type" })).toBeNull();
  });

  it("preserves a valid block id and repairs missing text", () => {
    const b = coerceBlock({ id: "blk-1", type: "heading", text: "Hi" });
    expect(b).toEqual({ id: "blk-1", type: "heading", text: "Hi" });
    const t = coerceBlock({ id: "blk-2", type: "text" }) as Block & { type: "text" };
    expect(t.text).toBe(""); // missing text repaired to empty string
  });

  it("synthesizes an id when one is missing", () => {
    const b = coerceBlock({ type: "divider" });
    expect(b?.type).toBe("divider");
    expect(typeof b?.id).toBe("string");
    expect(b?.id.length).toBeGreaterThan(0);
  });

  it("drops non-string bullet items", () => {
    const b = coerceBlock({ id: "b", type: "bullets", items: ["ok", 3, null, "two"] }) as Block & { type: "bullets" };
    expect(b.items).toEqual(["ok", "two"]);
  });

  describe("quiz answer clamping", () => {
    it("clamps an out-of-range answer to the last option", () => {
      const b = coerceBlock({ id: "q", type: "quiz", question: "?", options: ["a", "b"], answer: 9 }) as Block & { type: "quiz" };
      expect(b.answer).toBe(1);
    });

    it("coerces a numeric string answer and clamps negatives to 0", () => {
      const a = coerceBlock({ id: "q", type: "quiz", question: "?", options: ["a", "b", "c"], answer: "2" }) as Block & { type: "quiz" };
      expect(a.answer).toBe(2);
      const neg = coerceBlock({ id: "q", type: "quiz", question: "?", options: ["a", "b"], answer: -5 }) as Block & { type: "quiz" };
      expect(neg.answer).toBe(0);
    });

    it("defaults answer to 0 for NaN or no options", () => {
      const nan = coerceBlock({ id: "q", type: "quiz", question: "?", options: ["a", "b"], answer: "abc" }) as Block & { type: "quiz" };
      expect(nan.answer).toBe(0);
      const none = coerceBlock({ id: "q", type: "quiz", question: "?", options: [], answer: 3 }) as Block & { type: "quiz" };
      expect(none.answer).toBe(0);
    });
  });

  it("keeps a url on an image block only when it is a string", () => {
    const withUrl = coerceBlock({ id: "i", type: "image", prompt: "p", url: "https://x/y.png" }) as Block & { type: "image" };
    expect(withUrl.url).toBe("https://x/y.png");
    const noUrl = coerceBlock({ id: "i", type: "image", prompt: "p", url: 42 }) as Block & { type: "image" };
    expect("url" in noUrl).toBe(false);
  });

  it("round-trips every block newBlock can produce", () => {
    for (const type of ["heading", "text", "bullets", "quiz", "image", "divider"] as const) {
      const original = newBlock("seed", type);
      expect(coerceBlock(original)).toEqual(original);
    }
  });
});
