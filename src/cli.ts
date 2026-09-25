import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { pack } from "./pack/pack.js";
import { formatPack, formatList } from "./pack/format.js";
import { formatTokenCount } from "./pack/tokens.js";
import { parsePathList, readPathsFromSource, resolvePathsFromOption } from "./pack/pathsFrom.js";
import { formatInitSummary, InitError, runInit } from "./init/init.js";
import type { OutputFormat, ListFormat, PackResult } from "./types.js";

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
    .option("-l, --list", "preview which files would be included (dry-run)", false)
    .option(
      "-s, --since <ref>",
      "only include files changed since git ref (e.g. main, HEAD~1, commit SHA)",
    )
    .option(
      "--diff",
      "pack unified diffs of files changed since --since instead of full file contents (requires --since)",
      false,
    )
    .option(
      "--paths-from <file>",
      "pack only paths listed in a file (one per line; - reads stdin). Piped stdin without this flag is the same as -. Does not walk the tree",
    )
    .option(
      "--no-redact",
      "disable best-effort secret redaction (keep raw values; useful to inspect a false positive locally)",
    )
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
  $ contextpack pack . --list                   # Preview files without dumping contents
  $ contextpack pack . --list --format json     # JSON preview for agents
  $ contextpack pack . --since main             # Only files changed since main branch
  $ contextpack pack . --since HEAD~1 --list    # Preview changes from last commit
  $ contextpack pack . --since main --diff      # Pack unified diffs of changes since main
  $ rg -l 'JWT|auth' -g '*.ts' | contextpack pack . --budget 8000
  $ contextpack pack . --paths-from changed.txt --budget 4000 -o context.md
  $ contextpack pack . --paths-from paths.txt --list
  $ rg -l 'JWT|auth' -g '*.ts' | contextpack pack . --paths-from - --budget 8000
  $ contextpack pack . --no-redact              # Keep raw values (trusted local debug)

Notes:
  Token counts are estimates (characters / 4), not model-specific.
  Ignore layers: built-in defaults, then optional root .gitignore / .cursorignore / .aiignore / .copilotignore, then CLI --ignore. --include wins over ignores.
  --since requires git and a valid ref; includes modified, added, and untracked files.
  --diff requires --since. Tracked changes are packed as unified diffs; untracked files stay full content.
  A piped or redirected path list (non-TTY stdin) is treated as --paths-from - when the flag is omitted. Interactive terminals still walk the tree.
  --paths-from does not walk the tree. Paths are relative to [path]; absolute paths and .. escapes are skipped (stderr note unless --quiet). Combine with --since for the intersection. Explicit --paths-from <file> does not also read stdin.
  Secret redaction is on by default and best-effort (PEM blocks, common token prefixes, assignment forms). It is not a security scanner. Use --no-redact to keep raw values (e.g. to debug a false positive).
`,
    )
    .action((targetPath: string, opts) => {
      runPack(targetPath, opts);
    });

  program
    .command("init")
    .description("Write drop-in agent integration files (Cursor rule + skill)")
    .argument("[path]", "directory to write into", ".")
    .option("--force", "overwrite existing integration files", false)
    .option("--agents", "create or append a short AGENTS.md section", false)
    .option("-q, --quiet", "suppress stderr summary", false)
    .addHelpText(
      "after",
      `
Examples:
  $ contextpack init                            # Cursor rule + skill in cwd
  $ contextpack init ./my-repo                  # Write into a path
  $ contextpack init --agents                   # Also create/append AGENTS.md
  $ contextpack init --force                    # Overwrite existing files

Writes (create only if missing unless --force):
  .cursor/rules/contextpack.mdc
  skills/contextpack/SKILL.md
`,
    )
    .action((targetPath: string, opts: InitCliOpts) => {
      runInitCommand(targetPath, opts);
    });

  return program;
}

interface InitCliOpts {
  force?: boolean;
  agents?: boolean;
  quiet?: boolean;
}

function runInitCommand(targetPath: string, opts: InitCliOpts): void {
  try {
    const result = runInit(targetPath, {
      force: opts.force,
      agents: opts.agents,
    });
    if (!opts.quiet) {
      console.error(formatInitSummary(result));
    }
  } catch (err) {
    const message = err instanceof InitError || err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  }
}

interface PackCliOpts {
  budget: number;
  format: OutputFormat;
  out?: string;
  ignore: string[];
  include: string[];
  maxFileBytes?: number;
  quiet?: boolean;
  list?: boolean;
  since?: string;
  diff?: boolean;
  pathsFrom?: string;
  redact?: boolean;
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

  if (opts.diff && !opts.since) {
    console.error("error: --diff requires --since");
    process.exitCode = 1;
    return;
  }

  let listedPaths: string[] | undefined;
  const pathsSource = resolvePathsFromOption(opts.pathsFrom);
  if (pathsSource != null) {
    try {
      listedPaths = parsePathList(readPathsFromSource(pathsSource));
    } catch (err) {
      const where = pathsSource === "-" ? "stdin" : pathsSource;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`error: cannot read --paths-from ${where}: ${message}`);
      process.exitCode = 1;
      return;
    }
  }

  const packOptions = {
    budget: effectiveBudget,
    ignore: opts.ignore,
    include: opts.include,
    maxFileBytes: opts.maxFileBytes,
    since: opts.since,
    diff: opts.diff,
    paths: listedPaths,
    redact: opts.redact !== false,
  };

  let result: PackResult;

  if (opts.since || opts.diff) {
    const packResult = pack(root, packOptions as Parameters<typeof pack>[1] & { since: string });
    if (!packResult.ok) {
      console.error(`error: ${packResult.error.message}`);
      process.exitCode = 1;
      return;
    }
    result = packResult.value;
  } else {
    result = pack(root, packOptions);
  }

  if (!opts.quiet && result.notes.length > 0) {
    for (const note of result.notes) {
      console.error(`contextpack: ${note}`);
    }
  }

  if (opts.list) {
    const listFormat: ListFormat = opts.format === "json" ? "json" : "plain";
    const output = formatList(result, listFormat);

    if (opts.out) {
      const outPath = path.resolve(opts.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, output, "utf8");
      if (!opts.quiet) {
        printListSummary(result, outPath);
      }
    } else {
      process.stdout.write(output);
      if (!output.endsWith("\n")) process.stdout.write("\n");
      if (!opts.quiet) {
        printListSummary(result, null);
      }
    }
    return;
  }

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

function printSummary(result: PackResult, outPath: string | null): void {
  const parts: string[] = [];

  if (outPath) {
    parts.push(`wrote ${outPath}`);
  }

  parts.push(`${result.stats.included} files`);

  const diffCount = result.files.filter((f) => f.kind === "diff").length;
  if (diffCount > 0) {
    parts.push(`${diffCount} diffs`);
  }

  parts.push(`~${formatTokenCount(result.totalTokens)} tokens`);

  if (result.budget != null) {
    const pct = Math.round((result.totalTokens / result.budget) * 100);
    parts.push(`${pct}% of ${formatTokenCount(result.budget)} budget`);
  }

  if (result.stats.truncated > 0) {
    parts.push(`${result.stats.truncated} truncated`);
  }

  if (result.stats.redacted > 0) {
    parts.push(`${result.stats.redacted} redacted`);
  }

  console.error(`contextpack: ${parts.join(" · ")}`);
}

function printListSummary(result: PackResult, outPath: string | null): void {
  const parts: string[] = [];

  if (outPath) {
    parts.push(`wrote preview to ${outPath}`);
  }

  parts.push(`${result.stats.included} would be included`);

  const diffCount = result.files.filter((f) => f.kind === "diff").length;
  if (diffCount > 0) {
    parts.push(`${diffCount} diffs`);
  }

  parts.push(`~${formatTokenCount(result.totalTokens)} tokens`);

  if (result.budget != null) {
    const pct = Math.round((result.totalTokens / result.budget) * 100);
    parts.push(`${pct}% of ${formatTokenCount(result.budget)} budget`);
  }

  if (result.stats.redacted > 0) {
    parts.push(`${result.stats.redacted} redacted`);
  }

  console.error(`contextpack --list: ${parts.join(" · ")}`);
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
