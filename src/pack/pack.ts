import path from "node:path";
import { collectFiles, type CollectedFile } from "./collect.js";
import { selectUnderBudget } from "./budget.js";
import { getUnifiedDiffs } from "./git.js";
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
 * Returns a result type when `options.since` or `options.diff` is set
 * (git operations may fail). For backward compatibility, returns PackResult
 * directly when neither option is set.
 */
export function pack(root: string, options: PackOptions & { since: string }): PackReturn;
export function pack(root: string, options: PackOptions & { diff: true }): PackReturn;
export function pack(root: string, options?: PackOptions): PackResult;
export function pack(root: string, options: PackOptions = {}): PackResult | PackReturn {
  if (options.diff && !options.since) {
    return {
      ok: false,
      error: { code: "DIFF_REQUIRES_SINCE", message: "--diff requires --since" },
    };
  }

  const absRoot = path.resolve(root);
  const collectResult = collectFiles(absRoot, {
    ignore: options.ignore,
    include: options.include,
    maxFileBytes: options.maxFileBytes,
    since: options.since,
  });

  if (!collectResult.ok) {
    if (options.since || options.diff) {
      return { ok: false, error: collectResult.error };
    }
    // Should not happen without since, but handle gracefully
    throw new Error(collectResult.error.message);
  }

  const { files: collected, ignoredCount, git } = collectResult.value;

  if (options.diff && options.since) {
    const diffError = applyDiffContents(collected, git, options.since);
    if (diffError) {
      return { ok: false, error: diffError };
    }
  }

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

  if (options.since || options.diff) {
    return { ok: true, value: result };
  }
  return result;
}

/**
 * Replace tracked-file content with unified diffs since `ref`.
 * Untracked files keep full content (`kind: "file"`).
 */
function applyDiffContents(
  collected: CollectedFile[],
  git: { gitRoot: string; untracked: Set<string> } | undefined,
  ref: string,
): PackError | null {
  if (!git) {
    return { code: "GIT_ERROR", message: "--diff requires a git repository" };
  }

  const tracked = collected.filter((f) => !git.untracked.has(f.relPath));
  for (const file of collected) {
    if (git.untracked.has(file.relPath)) {
      file.kind = "file";
    }
  }

  const diffs = getUnifiedDiffs(
    git.gitRoot,
    ref,
    tracked.map((f) => f.absPath),
  );
  if (!diffs.ok) {
    return { code: diffs.error.code, message: diffs.error.message };
  }

  for (const file of tracked) {
    const diff = diffs.value.get(file.absPath);
    if (diff) {
      file.content = diff;
      file.kind = "diff";
      file.size = Buffer.byteLength(diff, "utf8");
    } else {
      // Empty / unparseable diff — keep the full file so we don't drop content.
      file.kind = "file";
    }
  }

  return null;
}

export type { PackOptions, PackResult };
