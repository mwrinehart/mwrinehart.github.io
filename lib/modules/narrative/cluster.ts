// Pure text-similarity helpers that group mentions into narratives. All
// transparent arithmetic (token cosine similarity), no ML, no I/O — the scan
// pipeline calls these and the unit tests pin the behavior.

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have he her his i if in into is it its " +
    "no not of on or our she so than that the their them then there these they this to " +
    "was we were what when which who will with you your about after all also am been " +
    "can could did do does had how just more most new now only other out over said say " +
    "says some up us very via why would"
  ).split(" "),
);

// Lowercase word tokens with stopwords and short/numeric noise dropped.
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9'-]+/g) ?? []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Cosine similarity over term-frequency vectors: 0 (disjoint) .. 1 (identical).
export function similarity(aTokens: string[], bTokens: string[]): number {
  if (!aTokens.length || !bTokens.length) return 0;
  const freq = (tokens: string[]) => {
    const m = new Map<string, number>();
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const a = freq(aTokens);
  const b = freq(bTokens);
  let dot = 0;
  for (const [t, n] of a) dot += n * (b.get(t) ?? 0);
  if (dot === 0) return 0;
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  return dot / (norm(a) * norm(b));
}

// Two texts about the same story usually share the load-bearing nouns even when
// paraphrased; unrelated headlines rarely clear this once stopwords are gone.
export const CLUSTER_THRESHOLD = 0.3;

// Pick the existing narrative a mention belongs to, or null to start a new one.
// `candidates` carry the narrative's representative text (title + claim + summary).
export function bestMatch(
  mentionText: string,
  candidates: Array<{ id: string; text: string }>,
  threshold: number = CLUSTER_THRESHOLD,
): string | null {
  const mention = tokenize(mentionText);
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const score = similarity(mention, tokenize(c.text));
    if (score >= threshold && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

// Case-insensitive watch-term matching over an item's text. Returns the terms
// that matched (a mention must match at least one to be ingested).
export function matchedWatchTerms(text: string, terms: string[]): string[] {
  const haystack = text.toLowerCase();
  return terms.filter((t) => {
    const needle = t.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}
