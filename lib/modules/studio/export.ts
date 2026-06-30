// Standalone HTML export of a course (rebuilt from Make's course-html export).
// Produces a self-contained document with inline styles — no external assets — so
// it can be hosted anywhere or wrapped into SCORM later. All authored text is
// HTML-escaped.

import type { Block, CourseDoc } from "./types";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBlock(b: Block): string {
  switch (b.type) {
    case "heading":
      return `<h2>${esc(b.text)}</h2>`;
    case "text":
      return `<p>${esc(b.text).replace(/\n/g, "<br>")}</p>`;
    case "bullets":
      return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    case "quiz":
      return `<div class="quiz"><p class="q">${esc(b.question)}</p><ol>${b.options
        .map((o, i) => `<li class="${i === b.answer ? "correct" : ""}">${esc(o)}${i === b.answer ? " ✓" : ""}</li>`)
        .join("")}</ol></div>`;
    case "image":
      return `<figure>${
        b.url ? `<img src="${esc(b.url)}" alt="${esc(b.prompt)}">` : `<div class="img-ph">🖼️ ${esc(b.prompt)}</div>`
      }<figcaption>${esc(b.prompt)}</figcaption></figure>`;
    case "divider":
      return `<hr>`;
  }
}

export function courseToHtml(title: string, doc: CourseDoc): string {
  const body = doc.blocks.map(renderBlock).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1a2336}
  h1{font-size:1.8rem} h2{margin-top:2rem;font-size:1.3rem}
  .quiz{background:#f4f6fb;border:1px solid #e2e8f5;border-radius:10px;padding:14px 18px;margin:1rem 0}
  .quiz .q{font-weight:600} .quiz li.correct{color:#1a8a55;font-weight:600}
  figure{margin:1.2rem 0} .img-ph{background:#eef2fb;border:1px dashed #c3cde6;border-radius:10px;padding:28px;text-align:center;color:#5a6b8c}
  figcaption{font-size:.85rem;color:#6b7793;margin-top:6px} hr{border:none;border-top:1px solid #e2e8f5;margin:2rem 0}
</style></head>
<body><h1>${esc(title)}</h1>
${body}
</body></html>`;
}
