import { describe, expect, it } from "vitest";
import { courseToHtml } from "./export";
import type { CourseDoc } from "./types";

const doc = (blocks: CourseDoc["blocks"]): CourseDoc => ({ blocks });

describe("courseToHtml", () => {
  it("HTML-escapes authored text", () => {
    const html = courseToHtml("Title", doc([{ id: "1", type: "heading", text: "<script>alert(1)</script>" }]));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes the document title", () => {
    const html = courseToHtml('<img src=x onerror=alert(1)>', doc([]));
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders an http image url but rejects javascript: and data:text/html", () => {
    const ok = courseToHtml("t", doc([{ id: "i", type: "image", prompt: "p", url: "https://cdn/x.png" }]));
    expect(ok).toContain('<img src="https://cdn/x.png"');

    const js = courseToHtml("t", doc([{ id: "i", type: "image", prompt: "p", url: "javascript:alert(1)" }]));
    expect(js).not.toContain("javascript:");
    expect(js).toContain("img-ph"); // falls back to the placeholder

    const dataHtml = courseToHtml("t", doc([{ id: "i", type: "image", prompt: "p", url: "data:text/html,<script>1</script>" }]));
    expect(dataHtml).not.toContain("data:text/html");
  });

  it("rejects data:image/svg+xml (active format) but allows raster data images", () => {
    const svg = courseToHtml("t", doc([{ id: "i", type: "image", prompt: "p", url: "data:image/svg+xml;base64,PHN2Zz4=" }]));
    expect(svg).not.toContain("data:image/svg+xml");
    expect(svg).toContain("img-ph");

    const png = courseToHtml("t", doc([{ id: "i", type: "image", prompt: "p", url: "data:image/png;base64,iVBORw0=" }]));
    expect(png).toContain("data:image/png;base64,iVBORw0=");
  });

  it("marks the correct quiz option", () => {
    const html = courseToHtml("t", doc([{ id: "q", type: "quiz", question: "Q?", options: ["wrong", "right"], answer: 1 }]));
    expect(html).toMatch(/<li class="correct">right ✓<\/li>/);
  });
});
