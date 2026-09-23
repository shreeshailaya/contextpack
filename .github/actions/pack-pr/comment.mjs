#!/usr/bin/env node
/**
 * Build the idempotent PR comment body from a contextpack --list JSON file.
 * Used by the pack-pr composite Action. Token counts are chars/4 estimates.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const COMMENT_MARKER = "<!-- contextpack-pr -->";

const DEFAULT_TOP_LIMIT = 12;

/** Match CLI formatTokenCount (src/pack/tokens.ts). */
export function formatTokenCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return "0";
  if (num < 1000) return String(Math.round(num));
  if (num < 10_000) return `${(num / 1000).toFixed(1)}k`;
  return `${Math.round(num / 1000)}k`;
}

function shortRef(ref) {
  if (!ref) return "(unknown)";
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.slice(0, 7);
  return ref;
}

function fileLabel(entry) {
  const parts = [];
  if (entry.kind === "diff") parts.push("diff");
  if (entry.status === "partial") parts.push("partial");
  if (entry.status === "truncated") parts.push("truncated");
  if (entry.status === "skipped") parts.push("skipped");
  const marker = parts.length ? ` [${parts.join("] [")}]` : "";
  const tok = entry.tokens > 0 ? ` — ~${formatTokenCount(entry.tokens)} tok` : "";
  return `- \`${entry.path}\`${tok}${marker}`;
}

function includedEntries(list) {
  if (!list?.entries) return [];
  return list.entries.filter((e) => e.status === "included" || e.status === "partial");
}

function artifactNote(name, filePath) {
  return `Full digest: \`${filePath}\` in the \`${name}\` workflow artifact.`;
}

/**
 * @param {object} opts
 * @param {object | null} [opts.list]
 * @param {string} [opts.since]
 * @param {string|number} [opts.budget]
 * @param {string} [opts.artifactName]
 * @param {string} [opts.artifactPath]
 * @param {string} [opts.error]
 * @param {boolean} [opts.empty]
 * @param {boolean} [opts.ok]
 * @param {boolean} [opts.diff]
 * @param {string} [opts.version]
 * @param {number} [opts.topLimit]
 */
export function buildComment(opts) {
  const {
    list = null,
    since = "",
    budget = "",
    artifactName = "contextpack-pr",
    artifactPath = "contextpack-pr.md",
    error = "",
    empty = false,
    ok = true,
    diff = true,
    version = "0.1.10",
    topLimit = DEFAULT_TOP_LIMIT,
  } = opts;

  const lines = [COMMENT_MARKER, "### contextpack PR digest", ""];
  const sinceLabel = shortRef(since);
  const flags = [`budget ${budget || "default"}`];
  if (diff) flags.push("--diff");
  flags.push(`@shree_vitkar/contextpack@${version}`);

  if (!ok && error) {
    lines.push(`contextpack could not pack this PR: ${error}`);
    lines.push("");
    lines.push(
      "The job continued because `fail-on-error` is false. Typical causes: missing git history (fetch the PR base SHA), not a git checkout, or an invalid `--since` ref.",
    );
    lines.push("");
    lines.push(`Tried to pack changes since \`${sinceLabel}\` (${flags.join(", ")}).`);
    return `${lines.join("\n")}\n`;
  }

  const included = includedEntries(list);
  const summary = list?.summary ?? {};
  const fileCount = included.length;
  const tokens = Number(summary.totalTokens ?? 0);
  const budgetNum = budget === "" || budget == null ? summary.budget : Number(budget);
  const isEmpty = empty || fileCount === 0;

  lines.push(
    `Packed changes since \`${sinceLabel}\` (${flags.join(", ")}). Token counts are estimates (chars÷4).`,
  );
  lines.push("");

  if (isEmpty) {
    lines.push(
      "No files to pack (nothing changed since the base, or everything was ignored). The job succeeded because `fail-on-empty` is false.",
    );
    lines.push("");
    lines.push(artifactNote(artifactName, artifactPath));
    return `${lines.join("\n")}\n`;
  }

  const table = [
    "| Metric | Value |",
    "| --- | --- |",
    `| Files included | ${fileCount} |`,
  ];

  const diffs = included.filter((e) => e.kind === "diff").length;
  if (diffs > 0) table.push(`| Diffs | ${diffs} |`);

  table.push(`| Approx. tokens | ~${formatTokenCount(tokens)} |`);

  if (budgetNum != null && Number.isFinite(Number(budgetNum)) && Number(budgetNum) > 0) {
    const pct = Math.round((tokens / Number(budgetNum)) * 100);
    table.push(`| Budget | ${budgetNum} (${pct}%) |`);
  } else if (budgetNum === 0) {
    table.push("| Budget | unlimited |");
  }

  if (summary.partial > 0) table.push(`| Partial (prefix only) | ${summary.partial} |`);
  if (summary.truncated > 0) table.push(`| Truncated (over budget) | ${summary.truncated} |`);

  lines.push(...table);
  lines.push("");

  const limit = Number.isFinite(topLimit) && topLimit > 0 ? topLimit : DEFAULT_TOP_LIMIT;
  const top = included.slice(0, limit);
  const rest = included.slice(limit);

  lines.push("**Included files**");
  lines.push("");
  for (const entry of top) lines.push(fileLabel(entry));
  lines.push("");

  if (rest.length > 0) {
    lines.push("<details>");
    lines.push(`<summary>All ${fileCount} files</summary>`);
    lines.push("");
    for (const entry of included) lines.push(fileLabel(entry));
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (Array.isArray(list?.entries)) {
    const truncated = list.entries.filter((e) => e.status === "truncated");
    if (truncated.length > 0) {
      lines.push("<details>");
      lines.push(`<summary>${truncated.length} truncated (over budget)</summary>`);
      lines.push("");
      for (const entry of truncated) lines.push(fileLabel(entry));
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push(artifactNote(artifactName, artifactPath));
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  let list = null;
  if (args.list) {
    try {
      list = JSON.parse(fs.readFileSync(args.list, "utf8"));
    } catch {
      list = null;
    }
  }

  const body = buildComment({
    list,
    since: args.since ?? "",
    budget: args.budget ?? "",
    artifactName: args["artifact-name"] ?? "contextpack-pr",
    artifactPath: args["artifact-path"] ?? "contextpack-pr.md",
    error: args.error ?? "",
    empty: args.empty === "true",
    ok: args.ok !== "false",
    diff: args.diff !== "false",
    version: args.version ?? "0.1.10",
    topLimit: args["top-limit"] != null ? Number(args["top-limit"]) : DEFAULT_TOP_LIMIT,
  });

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, body, "utf8");
  } else {
    process.stdout.write(body);
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
