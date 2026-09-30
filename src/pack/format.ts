import type {
  OutputFormat,
  PackResult,
  ListFormat,
  PackedFile,
  DigestMapEntry,
  DigestMapStatus,
} from "../types.js";
import { formatTokenCount } from "./tokens.js";
import { formatDigestMapMarkdown, formatDigestMapPlain } from "./map.js";

export function formatPack(result: PackResult, format: OutputFormat): string {
  switch (format) {
    case "json":
      return formatJson(result);
    case "plain":
      return formatPlain(result);
    case "md":
    default:
      return formatMarkdown(result);
  }
}

function formatMarkdown(result: PackResult): string {
  const lines: string[] = [];
  lines.push(`# contextpack digest`);
  lines.push("");
  lines.push(`Root: \`${result.root}\``);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Files included | ${result.stats.included} |`);
  lines.push(`| Approx. tokens | ~${formatTokenCount(result.totalTokens)} (chars÷4 estimate) |`);
  if (result.budget != null) {
    lines.push(`| Budget | ${result.budget} |`);
  }
  lines.push(`| Discovered | ${result.stats.discovered} |`);
  lines.push(`| Ignored | ${result.stats.ignored} |`);
  const partialCount = result.files.filter((f) => f.partial).length;
  if (partialCount > 0) {
    lines.push(`| Partial (prefix only) | ${partialCount} |`);
  }
  const diffCount = result.files.filter((f) => f.kind === "diff").length;
  if (diffCount > 0) {
    lines.push(`| Diffs | ${diffCount} |`);
  }
  if (result.stats.truncated > 0) {
    lines.push(`| Truncated (over budget) | ${result.stats.truncated} |`);
  }
  if (result.stats.skipped > 0) {
    lines.push(`| Skipped (binary/unreadable) | ${result.stats.skipped} |`);
  }
  if (result.stats.redacted > 0) {
    lines.push(`| Redacted (best-effort) | ${result.stats.redacted} |`);
  }
  if (result.stats.mapTokens > 0) {
    lines.push(
      `| Map | ${result.map.length} paths, ~${formatTokenCount(result.stats.mapTokens)} tok reserved |`,
    );
  }
  lines.push("");
  lines.push(`> Token counts are **estimates** (\`characters / 4\`), not model-specific tokenizer output.`);
  if (result.stats.redacted > 0) {
    lines.push(`> Secret redaction is **best-effort**, not a security scan. Use \`--no-redact\` to keep raw values.`);
  }
  if (result.stats.mapTokens > 0) {
    lines.push(
      `> The map is reserved from the budget (chars÷4 of this compact inventory) so it does not silently overflow. \`totalTokens\` is file bodies only. \`--no-map\` skips the map.`,
    );
  }
  lines.push("");
  if (result.stats.mapTokens > 0) {
    lines.push(formatDigestMapMarkdown(result.map).trimEnd());
    lines.push("");
  }
  lines.push(`## Files`);
  lines.push("");
  for (const f of result.files) {
    const marker = fileMarker(f);
    lines.push(`- \`${f.path}\` (~${formatTokenCount(f.tokens)} tok)${marker}`);
  }
  lines.push("");
  lines.push(`---`);
  lines.push("");

  for (const f of result.files) {
    const lang = f.kind === "diff" ? "diff" : fenceLang(f.path);
    const marker = fileMarker(f);
    lines.push(`## ${f.path}${marker}`);
    lines.push("");
    lines.push("```" + lang);
    lines.push(f.content.replace(/\n$/, ""));
    lines.push("```");
    if (f.partial) {
      lines.push("");
      lines.push("> **Note:** This file was truncated to fit the token budget. Only a prefix is shown.");
    }
    lines.push("");
  }

  if (result.truncated.length > 0) {
    lines.push(`## Truncated (over budget)`);
    lines.push("");
    for (const p of result.truncated) {
      lines.push(`- \`${p}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatPlain(result: PackResult): string {
  const lines: string[] = [];
  lines.push(`contextpack digest`);
  lines.push(`root: ${result.root}`);
  lines.push(
    `files: ${result.stats.included}  tokens(~): ${result.totalTokens}  budget: ${result.budget ?? "none"}`,
  );
  lines.push(`estimate: characters/4`);
  if (result.stats.mapTokens > 0) {
    lines.push(
      `map: ${result.map.length} paths, ~${result.stats.mapTokens} tok reserved (chars/4)`,
    );
  }
  lines.push("");
  if (result.stats.mapTokens > 0) {
    lines.push(formatDigestMapPlain(result.map).trimEnd());
    lines.push("");
  }

  for (const f of result.files) {
    const marker = fileMarker(f);
    lines.push(`===== ${f.path} (~${f.tokens} tok)${marker} =====`);
    lines.push(f.content.replace(/\n$/, ""));
    if (f.partial) {
      lines.push("[... truncated to fit budget ...]");
    }
    lines.push("");
  }

  if (result.truncated.length > 0) {
    lines.push(`===== truncated =====`);
    for (const p of result.truncated) lines.push(p);
  }

  return lines.join("\n");
}

function formatJson(result: PackResult): string {
  return JSON.stringify(
    {
      root: result.root,
      budget: result.budget,
      totalTokens: result.totalTokens,
      tokenEstimateNote: "approximate: characters / 4",
      ...(result.focus && result.focus.length > 0 ? { focus: result.focus } : {}),
      stats: result.stats,
      ...(result.stats.mapTokens > 0 ? { map: result.map, mapTokens: result.stats.mapTokens } : {}),
      truncated: result.truncated,
      skipped: result.skipped,
      files: result.files.map((f) => ({
        path: f.path,
        tokens: f.tokens,
        bytes: f.bytes,
        kind: f.kind ?? "file",
        partial: f.partial ?? false,
        content: f.content,
      })),
    },
    null,
    2,
  );
}

function fileMarker(f: PackedFile): string {
  const parts: string[] = [];
  if (f.kind === "diff") parts.push("diff");
  if (f.partial) parts.push("partial");
  return parts.length ? ` [${parts.join("] [")}]` : "";
}

function fenceLang(filePath: string): string {
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".") + 1) : "";
  const map: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    mjs: "js",
    cjs: "js",
    json: "json",
    md: "md",
    mdx: "mdx",
    py: "py",
    rb: "rb",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
  };
  return map[ext.toLowerCase()] ?? "";
}

/** Status for each file in list preview (same as the digest map). */
export type ListFileStatus = DigestMapStatus;

export type ListEntry = DigestMapEntry;

export interface ListPreview {
  root: string;
  budget: number | null;
  entries: ListEntry[];
  summary: {
    included: number;
    partial: number;
    truncated: number;
    skipped: number;
    totalTokens: number;
    discovered: number;
    ignored: number;
    redacted: number;
    mapTokens: number;
  };
}

function buildListPreview(result: PackResult): ListPreview {
  // Same inventory as the digest map (path-sorted). Do not dump bodies.
  const entries: ListEntry[] = result.map.map((e) => ({ ...e }));

  return {
    root: result.root,
    budget: result.budget,
    entries,
    summary: {
      included: entries.filter((e) => e.status === "included").length,
      partial: entries.filter((e) => e.status === "partial").length,
      truncated: entries.filter((e) => e.status === "truncated").length,
      skipped: entries.filter((e) => e.status === "skipped").length,
      totalTokens: result.totalTokens,
      discovered: result.stats.discovered,
      ignored: result.stats.ignored,
      redacted: result.stats.redacted,
      mapTokens: result.stats.mapTokens,
    },
  };
}

export function formatList(result: PackResult, format: ListFormat): string {
  const preview = buildListPreview(result);

  if (format === "json") {
    return formatListJson(preview);
  }
  return formatListPlain(preview);
}

function formatListPlain(preview: ListPreview): string {
  const lines: string[] = [];

  lines.push(`contextpack --list preview`);
  lines.push(`root: ${preview.root}`);
  lines.push(
    `budget: ${preview.budget != null ? formatTokenCount(preview.budget) : "unlimited"}`
  );
  lines.push(
    `discovered: ${preview.summary.discovered} · ignored: ${preview.summary.ignored}`
  );
  if (preview.summary.mapTokens > 0) {
    lines.push(
      `map reserved: ~${formatTokenCount(preview.summary.mapTokens)} tokens (chars/4; same inventory as digest Map)`
    );
  }
  lines.push(`statuses match the digest map; this preview has no file bodies`);
  lines.push("");

  const maxPathLen = Math.max(...preview.entries.map((e) => e.path.length), 10);
  const header = `${"PATH".padEnd(maxPathLen)}  ~TOKENS  STATUS`;
  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const entry of preview.entries) {
    const tokStr = entry.tokens > 0 ? formatTokenCount(entry.tokens) : "-";
    lines.push(
      `${entry.path.padEnd(maxPathLen)}  ${tokStr.padStart(7)}  ${entry.status}`
    );
  }

  lines.push("");
  lines.push("-".repeat(header.length));
  const parts: string[] = [];
  if (preview.summary.included > 0) parts.push(`${preview.summary.included} included`);
  if (preview.summary.partial > 0) parts.push(`${preview.summary.partial} partial`);
  if (preview.summary.truncated > 0) parts.push(`${preview.summary.truncated} truncated`);
  if (preview.summary.skipped > 0) parts.push(`${preview.summary.skipped} skipped`);
  lines.push(`${parts.join(" · ")} · ~${formatTokenCount(preview.summary.totalTokens)} tokens`);

  return lines.join("\n") + "\n";
}

function formatListJson(preview: ListPreview): string {
  return JSON.stringify(
    {
      root: preview.root,
      budget: preview.budget,
      tokenEstimateNote: "approximate: characters / 4",
      entries: preview.entries,
      summary: preview.summary,
    },
    null,
    2
  );
}
