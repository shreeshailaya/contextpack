/**
 * Honest naive-dump vs contextpack comparison.
 *
 * Run: `npm run benchmark`
 *
 * Every number printed here is computed in this process. Token figures are
 * estimates (`characters / 4`), the same heuristic `pack()` uses — not a
 * model-specific tokenizer.
 *
 * Naive dump = every text-ish file, with no gitignore, no default noise
 * filters, no ranking, and no budget. See `src/pack/naive.ts`.
 *
 * Packing calls the library `pack()` from `src/pack/pack.ts` (not a published
 * binary). Budgets 500 / 2000 / 0 (unlimited) match the CLI.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { naiveDump, type NaiveDump } from "../src/pack/naive.js";
import { pack } from "../src/pack/pack.js";
import type { PackResult } from "../src/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Budgets in tokens (chars/4). `0` means unlimited, same as the CLI. */
const BUDGETS = [500, 2000, 0] as const;

interface PackRow {
  label: string;
  budget: number;
  result: PackResult;
}

function packAt(root: string, budget: number): PackRow {
  const result = pack(root, { budget });
  const label = budget === 0 ? "Pack unlimited (0)" : `Pack budget ${budget}`;
  return { label, budget, result };
}

function savingsPct(naiveTokens: number, packedTokens: number): string {
  if (naiveTokens <= 0) return "n/a";
  const pct = ((naiveTokens - packedTokens) / naiveTokens) * 100;
  if (Math.abs(pct) < 0.05) return "0%";
  const rounded = pct.toFixed(0);
  return pct > 0 ? `-${rounded}%` : `+${Math.abs(Number(rounded))}%`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  if (s.length >= width) return s;
  const fill = " ".repeat(width - s.length);
  return align === "right" ? fill + s : s + fill;
}

function printTable(naive: NaiveDump, rows: PackRow[]): void {
  const header = [
    pad("Mode", 24),
    pad("Files", 7, "right"),
    pad("~Tokens (est.)", 16, "right"),
    pad("vs naive", 10, "right"),
    pad("Truncated", 11, "right"),
    pad("Partial", 9, "right"),
  ].join("  ");
  const rule = "-".repeat(header.length);
  console.log(header);
  console.log(rule);
  console.log(
    [
      pad("Naive dump", 24),
      pad(fmtInt(naive.fileCount), 7, "right"),
      pad(fmtInt(naive.totalTokens), 16, "right"),
      pad("—", 10, "right"),
      pad("—", 11, "right"),
      pad("—", 9, "right"),
    ].join("  "),
  );
  for (const row of rows) {
    const partial = row.result.files.filter((f) => f.partial).length;
    console.log(
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
}

function printFileList(title: string, files: { path?: string; relPath?: string; tokens: number; partial?: boolean }[]): void {
  console.log(title);
  if (files.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const f of files) {
    const p = f.path ?? f.relPath ?? "";
    const extra = f.partial ? " [partial]" : "";
    console.log(`  ${p}  (~${fmtInt(f.tokens)} est.)${extra}`);
  }
}

function runSubject(name: string, root: string): void {
  const naive = naiveDump(root);
  const rows = BUDGETS.map((b) => packAt(root, b));

  console.log("");
  console.log(`## ${name}`);
  console.log(`Root: ${path.relative(repoRoot, root) || "."}`);
  console.log("");
  printTable(naive, rows);
  console.log("");
  printFileList("Naive dump files:", naive.files);
  console.log("");
  for (const row of rows) {
    printFileList(`${row.label} — included:`, row.result.files);
    if (row.result.truncated.length > 0) {
      console.log(`${row.label} — truncated (over budget):`);
      for (const p of row.result.truncated) {
        console.log(`  ${p}`);
      }
    } else if (row.budget > 0) {
      console.log(`${row.label} — truncated: (none; selection fit the budget)`);
    }
    console.log("");
  }
}

function main(): void {
  console.log("contextpack benchmark");
  console.log("Token estimates: characters / 4 (not a model tokenizer).");
  console.log("");
  console.log("Naive dump means:");
  console.log("  - every text-ish file (known text extensions/basenames, or extensionless + no NUL)");
  console.log("  - NO .gitignore, NO default ignores, NO ranking, NO budget");
  console.log("  - still skips .git/, symlinks, unreadable files, and NUL (binary) files");
  console.log("");
  console.log("Packed rows call pack() from src/pack/pack.ts in-process.");

  const fixture = path.join(repoRoot, "fixtures", "demo-project");
  runSubject("fixtures/demo-project (primary)", fixture);

  // Secondary: clean source tree. Unlimited pack should match naive closely;
  // budgets still truncate. Counts move when src/ changes — not recorded in docs.
  const src = path.join(repoRoot, "src");
  runSubject("src/ (secondary; live, not frozen in docs)", src);
}

main();
