import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { pack } from "./pack/pack.js";
import { formatPack } from "./pack/format.js";
import { formatTokenCount } from "./pack/tokens.js";
import type { OutputFormat } from "./types.js";

const VERSION = "0.1.0";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("contextpack")
    .description(
      "Pack a codebase into clean, token-budgeted context for humans and AI coding agents.",
    )
    .version(VERSION);

  program
    .command("pack")
    .description("Pack a directory into a readable / agent-ready context digest")
    .argument("[path]", "directory to pack", ".")
    .option(
      "-b, --budget <tokens>",
      "max approximate tokens (chars÷4 estimate). Omit for no budget.",
      parseBudget,
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
  $ contextpack pack .
  $ contextpack pack ./src --budget 8000 --format md
  $ contextpack pack . --budget 12000 --format json --out context.json
  $ contextpack pack . --ignore '*.generated.ts' --include 'dist/schema.json'

Notes:
  Token counts are estimates (characters / 4), not model-specific.
  Respects .gitignore plus built-in ignores (node_modules, lockfiles, binaries, media, secrets).
`,
    )
    .action((targetPath: string, opts) => {
      runPack(targetPath, opts);
    });

  return program;
}

interface PackCliOpts {
  budget?: number;
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

  const result = pack(root, {
    budget: opts.budget ?? null,
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
      console.error(
        `wrote ${outPath}  (${result.stats.included} files, ~${formatTokenCount(result.totalTokens)} tokens)`,
      );
    }
  } else {
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");
  }

  if (!opts.quiet && opts.out == null) {
    // Summary on stderr so stdout stays pure digest when piping
    console.error(
      `contextpack: ${result.stats.included} files, ~${formatTokenCount(result.totalTokens)} tokens` +
        (result.budget != null ? ` / budget ${result.budget}` : "") +
        (result.stats.truncated ? `, ${result.stats.truncated} truncated` : "") +
        (result.stats.ignored ? `, ${result.stats.ignored} ignored` : ""),
    );
  }
}

function parseBudget(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid --budget: ${value} (expected positive number)`);
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
