/**
 * Approximate token estimation.
 *
 * This is intentionally a simple heuristic (characters / 4), not a model-specific
 * tokenizer. Documented as an *estimate* for budgeting and ranking — good enough
 * for packing decisions, not for billing or exact context windows.
 */
export const CHARS_PER_TOKEN = 4;

/** Estimate tokens from a UTF-8 string. Always >= 0. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate tokens from byte length (UTF-8 approx). */
export function estimateTokensFromBytes(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
