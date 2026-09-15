import path from "node:path";
import { collectFiles, type CollectError } from "./collect.js";
import { selectUnderBudget } from "./budget.js";
import type { PackOptions, PackResult } from "../types.js";

export interface PackError {
  code: string;
  message: string;
}

export type PackReturn =
  | { ok: true; value: PackResult }
  | { ok: false; error: PackError };

/**
 * Pack a directory into a token-budgeted context digest.
 *
 * Architecture note: collect → budget-select → (format in CLI layer).
 * Future: ranking plugins, streaming writers, remote sources can plug in here.
 *
 * Returns a result type when `options.since` is set (git operations may fail).
 * For backward compatibility, returns PackResult directly when no since option.
 */
export function pack(root: string, options: PackOptions & { since: string }): PackReturn;
export function pack(root: string, options?: PackOptions): PackResult;
export function pack(root: string, options: PackOptions = {}): PackResult | PackReturn {
  const absRoot = path.resolve(root);
  const collectResult = collectFiles(absRoot, {
    ignore: options.ignore,
    include: options.include,
    maxFileBytes: options.maxFileBytes,
    since: options.since,
  });

  if (!collectResult.ok) {
    if (options.since) {
      return { ok: false, error: collectResult.error };
    }
    // Should not happen without since, but handle gracefully
    throw new Error(collectResult.error.message);
  }

  const { files: collected, ignoredCount } = collectResult.value;
  const budget = options.budget ?? null;
  const selection = selectUnderBudget(collected, budget);

  const result: PackResult = {
    root: absRoot,
    files: selection.files,
    totalTokens: selection.totalTokens,
    budget,
    truncated: selection.truncated,
    skipped: selection.skipped,
    stats: {
      discovered: collected.length,
      included: selection.files.length,
      ignored: ignoredCount,
      truncated: selection.truncated.length,
      skipped: selection.skipped.length,
    },
  };

  if (options.since) {
    return { ok: true, value: result };
  }
  return result;
}

export type { PackOptions, PackResult };
