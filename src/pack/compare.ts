/**
 * Honest naive-dump vs packed comparison for any directory.
 *
 * Token figures are estimates (`characters / 4`), the same heuristic `pack()`
 * uses — not a model-specific tokenizer.
 *
 * Naive dump = every text-ish file, with no gitignore, no default noise
 * filters, no ranking, and no budget. See `src/pack/naive.ts`.
 *
 * Packed rows call the library `pack()` in-process (not a published binary).
 * `--ignore` / `--include` / `--max-file-bytes` apply to pack() only.
 */

import fs from "node:fs";
import path from "node:path";
import { naiveDump, type NaiveDump } from "./naive.js";
import { pack } from "./pack.js";
import type { PackOptions, PackResult } from "../types.js";

/** Budgets in tokens (chars/4). `0` means unlimited, same as the CLI. */
export const DEFAULT_COMPARE_BUDGETS = [500, 2000, 0] as const;

export class CompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareError";
  }
}

export interface CompareOptions {
  /** Token budgets to pack at. Empty / omitted uses DEFAULT_COMPARE_BUDGETS. */
  budgets?: readonly number[];
  /** Extra ignore patterns for pack() only. Naive stays raw. */
  ignore?: string[];
  /** Force-include patterns for pack() only. */
  include?: string[];
  /** Max file size for pack() only. */
  maxFileBytes?: number;
}

export interface ComparePackRow {
  label: string;
  budget: number;
  result: PackResult;
}

export interface CompareResult {
  root: string;
  naive: NaiveDump;
  rows: ComparePackRow[];
}

export function packLabel(budget: number): string {
  return budget === 0 ? "Pack unlimited (0)" : `Pack budget ${budget}`;
}

export function savingsPct(naiveTokens: number, packedTokens: number): string {
  if (naiveTokens <= 0) return "n/a";
  const pct = ((naiveTokens - packedTokens) / naiveTokens) * 100;
  if (Math.abs(pct) < 0.05) return "0%";
  const rounded = pct.toFixed(0);
  return pct > 0 ? `-${rounded}%` : `+${Math.abs(Number(rounded))}%`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  if (s.length >= width) return s;
  const fill = " ".repeat(width - s.length);
  return align === "right" ? fill + s : s + fill;
}

export function resolveCompareRoot(root: string): string {
  const absRoot = path.resolve(root);
  if (!fs.existsSync(absRoot)) {
    throw new CompareError(`path not found: ${absRoot}`);
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(absRoot);
  } catch {
    throw new CompareError(`cannot read path: ${absRoot}`);
  }
  if (!st.isDirectory()) {
    throw new CompareError(`not a directory: ${absRoot}`);
  }
  return absRoot;
}

export function compareDirectory(root: string, options: CompareOptions = {}): CompareResult {
  const absRoot = resolveCompareRoot(root);
  const budgets =
    options.budgets && options.budgets.length > 0
      ? [...options.budgets]
      : [...DEFAULT_COMPARE_BUDGETS];

  const naive = naiveDump(absRoot);
  const packExtras: Pick<PackOptions, "ignore" | "include" | "maxFileBytes"> = {};
  if (options.ignore && options.ignore.length > 0) packExtras.ignore = options.ignore;
  if (options.include && options.include.length > 0) packExtras.include = options.include;
  if (options.maxFileBytes != null) packExtras.maxFileBytes = options.maxFileBytes;

  const rows = budgets.map((budget) => {
    const result = pack(absRoot, {
      ...packExtras,
      budget: budget === 0 ? null : budget,
    });
    return { label: packLabel(budget), budget, result };
  });

  return { root: absRoot, naive, rows };
}

export function formatCompareMethodology(): string {
  return [
    "Token estimates: characters / 4 (not a model tokenizer).",
    "",
    "Naive dump means:",
    "  - every text-ish file (known text extensions/basenames, or extensionless + no NUL)",
    "  - NO .gitignore, NO default ignores, NO ranking, NO budget",
    "  - still skips .git/, symlinks, unreadable files, and NUL (binary) files",
    "",
    "Packed rows call pack() in-process (not a published binary).",
  ].join("\n");
}

export function formatCompareTable(naive: NaiveDump, rows: ComparePackRow[]): string {
  const header = [
    pad("Mode", 24),
    pad("Files", 7, "right"),
    pad("~Tokens (est.)", 16, "right"),
    pad("vs naive", 10, "right"),
    pad("Truncated", 11, "right"),
    pad("Partial", 9, "right"),
  ].join("  ");
  const rule = "-".repeat(header.length);
  const lines = [
    header,
    rule,
    [
      pad("Naive dump", 24),
      pad(fmtInt(naive.fileCount), 7, "right"),
      pad(fmtInt(naive.totalTokens), 16, "right"),
      pad("—", 10, "right"),
      pad("—", 11, "right"),
      pad("—", 9, "right"),
    ].join("  "),
  ];

  for (const row of rows) {
    const partial = row.result.files.filter((f) => f.partial).length;
    lines.push(
      [
        pad(row.label, 24),
        pad(fmtInt(row.result.stats.included), 7, "right"),
        pad(fmtInt(row.result.totalTokens), 16, "right"),
        pad(savingsPct(naive.totalTokens, row.result.totalTokens), 10, "right"),
        pad(fmtInt(row.result.stats.truncated), 11, "right"),
        pad(fmtInt(partial), 9, "right"),
      ].join("  "),
    );
  }

  return lines.join("\n");
}

export function formatCompareReport(result: CompareResult, title = "contextpack compare"): string {
  const displayRoot = path.relative(process.cwd(), result.root) || ".";
  return [
    title,
    formatCompareMethodology(),
    "",
    `Root: ${displayRoot}`,
    "",
    formatCompareTable(result.naive, result.rows),
    "",
  ].join("\n");
}
