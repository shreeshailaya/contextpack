/**
 * Honest naive-dump vs contextpack comparison.
 *
 * Run: `npm run benchmark`
 *
 * Same methodology as `contextpack compare` — see `src/pack/compare.ts`.
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
import {
  DEFAULT_COMPARE_BUDGETS,
  compareDirectory,
  fmtInt,
  formatCompareMethodology,
  formatCompareTable,
  type ComparePackRow,
} from "../src/pack/compare.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printFileList(
  title: string,
  files: { path?: string; relPath?: string; tokens: number; partial?: boolean }[],
): void {
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
  const compared = compareDirectory(root, { budgets: DEFAULT_COMPARE_BUDGETS });

  console.log("");
  console.log(`## ${name}`);
  console.log(`Root: ${path.relative(repoRoot, compared.root) || "."}`);
  console.log("");
  console.log(formatCompareTable(compared.naive, compared.rows));
  console.log("");
  printFileList("Naive dump files:", compared.naive.files);
  console.log("");
  for (const row of compared.rows) {
    printFileList(`${row.label} — included:`, row.result.files);
    printTruncated(row);
    console.log("");
  }
}

function printTruncated(row: ComparePackRow): void {
  if (row.result.truncated.length > 0) {
    console.log(`${row.label} — truncated (over budget):`);
    for (const p of row.result.truncated) {
      console.log(`  ${p}`);
    }
  } else if (row.budget > 0) {
    console.log(`${row.label} — truncated: (none; selection fit the budget)`);
  }
}

function main(): void {
  console.log("contextpack benchmark");
  console.log(formatCompareMethodology());

  const fixture = path.join(repoRoot, "fixtures", "demo-project");
  runSubject("fixtures/demo-project (primary)", fixture);

  // Secondary: clean source tree. Unlimited pack should match naive closely;
  // budgets still truncate. Counts move when src/ changes — not recorded in docs.
  const src = path.join(repoRoot, "src");
  runSubject("src/ (secondary; live, not frozen in docs)", src);
}

main();
