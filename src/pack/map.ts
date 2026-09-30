import type { DigestMapEntry, DigestMapStatus, PackedFile, PackedFileKind } from "../types.js";
import { estimateTokens, formatTokenCount } from "./tokens.js";

export interface MapCandidate {
  path: string;
  tokens: number;
  kind?: PackedFileKind;
}

/**
 * Build a path-sorted inventory of discovered candidates.
 * Partial files are `partial` (not also `truncated`). Token counts are chars/4.
 */
export function buildDigestMap(args: {
  files: PackedFile[];
  truncated: string[];
  skipped: string[];
  candidateTokens: Map<string, number>;
  candidateKinds?: Map<string, PackedFileKind>;
}): DigestMapEntry[] {
  const { files, truncated, skipped, candidateTokens, candidateKinds } = args;
  const included = new Map(files.map((f) => [f.path, f]));
  const partialPaths = new Set(files.filter((f) => f.partial).map((f) => f.path));
  const seen = new Set<string>();
  const entries: DigestMapEntry[] = [];

  const add = (path: string, status: DigestMapStatus, tokens: number, kind: PackedFileKind) => {
    if (seen.has(path)) return;
    seen.add(path);
    entries.push({ path, status, tokens, kind });
  };

  for (const f of files) {
    add(f.path, f.partial ? "partial" : "included", f.tokens, f.kind ?? "file");
  }

  for (const p of truncated) {
    if (partialPaths.has(p)) continue;
    add(
      p,
      "truncated",
      candidateTokens.get(p) ?? 0,
      candidateKinds?.get(p) ?? included.get(p)?.kind ?? "file",
    );
  }

  for (const p of skipped) {
    add(p, "skipped", 0, candidateKinds?.get(p) ?? "file");
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

/** Markdown map section (canonical text used for the chars/4 reserve). */
export function formatDigestMapMarkdown(entries: DigestMapEntry[]): string {
  const lines: string[] = [];
  lines.push("## Map");
  lines.push("");
  lines.push(
    "Discovered candidates. Status matches `--list`. Token counts are chars÷4 estimates.",
  );
  lines.push("");

  if (entries.length === 0) {
    lines.push("_No discovered candidates._");
    lines.push("");
    return lines.join("\n");
  }

  for (const e of entries) {
    lines.push(formatMapLine(e, true));
  }
  lines.push("");
  return lines.join("\n");
}

/** Compact plain-text map (digest `--format plain`). */
export function formatDigestMapPlain(entries: DigestMapEntry[]): string {
  const lines: string[] = [];
  lines.push("===== map =====");
  for (const e of entries) {
    lines.push(formatMapLine(e, false));
  }
  lines.push("");
  return lines.join("\n");
}

/** chars/4 of the canonical markdown map (what we reserve from the budget). */
export function estimateMapTokens(entries: DigestMapEntry[]): number {
  return estimateTokens(formatDigestMapMarkdown(entries));
}

/**
 * Conservative reserve before selection: same paths, `truncated` status,
 * full-file token estimates. Actual map is never larger.
 */
export function estimateMapReserve(candidates: MapCandidate[]): number {
  const entries: DigestMapEntry[] = candidates
    .map((c) => ({
      path: c.path,
      status: "truncated" as const,
      tokens: c.tokens,
      kind: c.kind ?? "file",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return estimateMapTokens(entries);
}

function formatMapLine(entry: DigestMapEntry, markdown: boolean): string {
  const tok = entry.tokens > 0 ? ` (~${formatTokenCount(entry.tokens)})` : "";
  const kind = entry.kind === "diff" ? " [diff]" : "";
  if (markdown) {
    return `- \`${entry.path}\` ${entry.status}${tok}${kind}`;
  }
  return `${entry.path}  ${entry.status}${tok}${kind}`;
}
