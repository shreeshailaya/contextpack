import path from "node:path";
import { collectFiles } from "./collect.js";
import { selectUnderBudget } from "./budget.js";
import type { PackOptions, PackResult } from "../types.js";

/**
 * Pack a directory into a token-budgeted context digest.
 *
 * Architecture note: collect → budget-select → (format in CLI layer).
 * Future: ranking plugins, streaming writers, remote sources can plug in here.
 */
export function pack(root: string, options: PackOptions = {}): PackResult {
  const absRoot = path.resolve(root);
  const { files: collected, ignoredCount } = collectFiles(absRoot, {
    ignore: options.ignore,
    include: options.include,
    maxFileBytes: options.maxFileBytes,
  });

  const budget = options.budget ?? null;
  const selection = selectUnderBudget(collected, budget);

  return {
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
}

export type { PackOptions, PackResult };
