import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { pack } from "./pack/pack.js";
import { formatPack } from "./pack/format.js";
import { formatTokenCount } from "./pack/tokens.js";
import type { OutputFormat } from "./types.js";

function getVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.1.0";
  }
}

const VERSION = getVersion();
const DEFAULT_BUDGET = 16000;

export function createProgram(): Command {
  const program = new Command();

  program
    .name("contextpack")
    .description("Don't dump the repo into the model. Pack what matters.")
    .version(VERSION, "-V, --version", "print version");

  program
    .command("pack")
    .description("Pack a directory into a readable / agent-ready context digest")
    .argument("[path]", "directory to pack", ".")
    .option(
      "-b, --budget <tokens>",
      `max approximate tokens (chars÷4). Default: ${DEFAULT_BUDGET}. Use 0 for unlimited.`,
      parseBudget,
      DEFAULT_BUDGET,
    )
    .option(
      "-f, --format <format>",
      "output format: md | json | plain",
      parseFormat,
      "md" as OutputFormat,
    )
    .option("-o, --out <file>", "write digest to file instead of stdout")
    .option(
      "-i, --ignore <pattern>",
      "extra ignore pattern (gitignore syntax; repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--include <pattern>",
      "force-include pattern (overrides ignores; repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--max-file-bytes <n>",
      "skip files larger than this many bytes (default 524288)",
      (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1) {
          throw new Error(`Invalid --max-file-bytes: ${v}`);
        }
        return Math.floor(n);
      },
    )
    .option("-q, --quiet", "suppress stderr summary", false)
    .addHelpText(
      "after",
      `
Examples:
  $ contextpack pack .                          # Pack with default budget (${DEFAULT_BUDGET} tokens)
  $ contextpack pack ./src --budget 8000        # Custom budget
  $ contextpack pack . --budget 0               # No budget (include all)
  $ contextpack pack . -o context.md            # Write to file
  $ contextpack pack . --format json            # JSON output
  $ contextpack pack . --ignore 'tests/**'      # Skip tests

Notes:
  Token counts are estimates (characters / 4), not model-specific.
  Respects .gitignore plus built-in ignores (node_modules, lockfiles, binaries, secrets).
`,
    )
    .action((targetPath: string, opts) => {
      runPack(targetPath, opts);
    });

  return program;
}

interface PackCliOpts {
  budget: number;
  format: OutputFormat;
  out?: string;
  ignore: string[];
  include: string[];
  maxFileBytes?: number;
  quiet?: boolean;
}

function runPack(targetPath: string, opts: PackCliOpts): void {
  const root = path.resolve(targetPath);

  if (!fs.existsSync(root)) {
    console.error(`error: path not found: ${root}`);
    process.exitCode = 1;
    return;
  }

  const st = fs.statSync(root);
  if (!st.isDirectory()) {
    console.error(`error: not a directory: ${root}`);
    process.exitCode = 1;
    return;
  }

  const effectiveBudget = opts.budget === 0 ? null : opts.budget;

  const result = pack(root, {
    budget: effectiveBudget,
    ignore: opts.ignore,
    include: opts.include,
    maxFileBytes: opts.maxFileBytes,
  });

  const output = formatPack(result, opts.format);

  if (opts.out) {
    const outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, "utf8");
    if (!opts.quiet) {
      printSummary(result, outPath);
    }
  } else {
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");
    if (!opts.quiet) {
      printSummary(result, null);
    }
  }
}

function printSummary(result: import("./types.js").PackResult, outPath: string | null): void {
  const parts: string[] = [];

  if (outPath) {
    parts.push(`wrote ${outPath}`);
  }

  parts.push(`${result.stats.included} files`);
  parts.push(`~${formatTokenCount(result.totalTokens)} tokens`);

  if (result.budget != null) {
    const pct = Math.round((result.totalTokens / result.budget) * 100);
    parts.push(`${pct}% of ${formatTokenCount(result.budget)} budget`);
  }

  if (result.stats.truncated > 0) {
    parts.push(`${result.stats.truncated} truncated`);
  }

  console.error(`contextpack: ${parts.join(" · ")}`);
}

function parseBudget(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid --budget: ${value} (expected non-negative number)`);
  }
  return Math.floor(n);
}

function parseFormat(value: string): OutputFormat {
  const v = value.toLowerCase();
  if (v === "md" || v === "markdown") return "md";
  if (v === "json") return "json";
  if (v === "plain" || v === "text" || v === "txt") return "plain";
  throw new Error(`Invalid --format: ${value} (expected md|json|plain)`);
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
