/**
 * `--focus` term parsing and matching.
 *
 * Matching is a case-insensitive substring check on the relative path and
 * (when available) packed content. This is not semantic search.
 */

/**
 * Parse `--focus` input into unique terms.
 * Splits on commas, then whitespace. Empty / whitespace-only pieces are dropped.
 * Repeated flags are concatenated. First-seen casing is kept for display.
 */
export function parseFocusTerms(raw: string | readonly string[] | undefined | null): string[] {
  if (raw == null) return [];
  const chunks = Array.isArray(raw) ? raw : [raw];
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (typeof chunk !== "string") continue;
    for (const commaPart of chunk.split(",")) {
      for (const piece of commaPart.split(/\s+/)) {
        const term = piece.trim();
        if (!term) continue;
        const key = term.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push(term);
      }
    }
  }

  return terms;
}

/**
 * True if any focus term appears in the relative path or packed content.
 * `content` may be a full file body or a unified diff. Missing content is
 * path-only matching (no extra disk read).
 */
export function matchesFocus(
  relPath: string,
  content: string | undefined,
  terms: string[],
): boolean {
  if (terms.length === 0) return false;

  const pathLower = relPath.toLowerCase();
  const contentLower = content === undefined ? undefined : content.toLowerCase();

  for (const term of terms) {
    const t = term.toLowerCase();
    if (!t) continue;
    if (pathLower.includes(t)) return true;
    if (contentLower !== undefined && contentLower.includes(t)) return true;
  }

  return false;
}
