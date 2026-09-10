import { estimateTokens } from "./tokens.js";
import type { PackedFile } from "../types.js";
import type { CollectedFile } from "./collect.js";
import { readTextFile } from "./collect.js";

export interface BudgetSelection {
  files: PackedFile[];
  truncated: string[];
  skipped: string[];
  totalTokens: number;
}

/**
 * Score files so high-signal sources tend to win under a tight budget.
 * Lower score = higher priority.
 */
function priorityScore(relPath: string): number {
  const p = relPath.toLowerCase();
  const base = p.split("/").pop() ?? p;

  // Root docs & manifests first
  if (/^readme(\.|$)/i.test(base)) return 0;
  if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json)$/i.test(base))
    return 1;
  if (/^(tsconfig|jsconfig)/i.test(base)) return 2;
  if (/^(license|licence|contributing|changelog)/i.test(base)) return 3;

  // Prefer src/ over tests/fixtures
  if (/(^|\/)(test|tests|__tests__|spec|specs|fixtures?|mocks?|e2e)(\/|$)/.test(p))
    return 80;
  if (/(^|\/)(src|lib|app|pkg|cmd)(\/|$)/.test(p)) return 10;

  // Config near the middle
  if (/\.(ya?ml|toml|json|ini|conf)$/i.test(base)) return 30;

  return 40;
}

/**
 * Select files under an optional token budget.
 * When budgeting, files are sorted by priority then size (smaller first within tier).
 */
export function selectUnderBudget(
  collected: CollectedFile[],
  budget: number | null | undefined,
): BudgetSelection {
  const prepared: { meta: CollectedFile; content: string; tokens: number }[] = [];
  const skipped: string[] = [];

  for (const meta of collected) {
    const content = readTextFile(meta.absPath);
    if (content === null) {
      skipped.push(meta.relPath);
      continue;
    }
    const tokens = estimateTokens(content);
    prepared.push({ meta, content, tokens });
  }

  // Stable order for no-budget path: alphabetical (already sorted by collect)
  if (budget == null || budget <= 0) {
    const files: PackedFile[] = prepared.map(({ meta, content, tokens }) => ({
      path: meta.relPath,
      content,
      tokens,
      bytes: Buffer.byteLength(content, "utf8"),
    }));
    return {
      files,
      truncated: [],
      skipped,
      totalTokens: files.reduce((s, f) => s + f.tokens, 0),
    };
  }

  prepared.sort((a, b) => {
    const pa = priorityScore(a.meta.relPath);
    const pb = priorityScore(b.meta.relPath);
    if (pa !== pb) return pa - pb;
    if (a.tokens !== b.tokens) return a.tokens - b.tokens;
    return a.meta.relPath.localeCompare(b.meta.relPath);
  });

  const files: PackedFile[] = [];
  const truncated: string[] = [];
  let totalTokens = 0;

  for (const item of prepared) {
    if (totalTokens + item.tokens > budget) {
      truncated.push(item.meta.relPath);
      continue;
    }
    files.push({
      path: item.meta.relPath,
      content: item.content,
      tokens: item.tokens,
      bytes: Buffer.byteLength(item.content, "utf8"),
    });
    totalTokens += item.tokens;
  }

  // Present included files in path order for readable digests
  files.sort((a, b) => a.path.localeCompare(b.path));

  return { files, truncated, skipped, totalTokens };
}
