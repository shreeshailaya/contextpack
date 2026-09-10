import type { OutputFormat, PackResult } from "../types.js";
import { formatTokenCount } from "./tokens.js";

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
  if (result.stats.truncated > 0) {
    lines.push(`| Truncated (over budget) | ${result.stats.truncated} |`);
  }
  if (result.stats.skipped > 0) {
    lines.push(`| Skipped (binary/unreadable) | ${result.stats.skipped} |`);
  }
  lines.push("");
  lines.push(`> Token counts are **estimates** (\`characters / 4\`), not model-specific tokenizer output.`);
  lines.push("");
  lines.push(`## Files`);
  lines.push("");
  for (const f of result.files) {
    lines.push(`- \`${f.path}\` (~${formatTokenCount(f.tokens)} tok)`);
  }
  lines.push("");
  lines.push(`---`);
  lines.push("");

  for (const f of result.files) {
    const lang = fenceLang(f.path);
    lines.push(`## ${f.path}`);
    lines.push("");
    lines.push("```" + lang);
    lines.push(f.content.replace(/\n$/, ""));
    lines.push("```");
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
  lines.push("");

  for (const f of result.files) {
    lines.push(`===== ${f.path} (~${f.tokens} tok) =====`);
    lines.push(f.content.replace(/\n$/, ""));
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
      stats: result.stats,
      truncated: result.truncated,
      skipped: result.skipped,
      files: result.files.map((f) => ({
        path: f.path,
        tokens: f.tokens,
        bytes: f.bytes,
        content: f.content,
      })),
    },
    null,
    2,
  );
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
