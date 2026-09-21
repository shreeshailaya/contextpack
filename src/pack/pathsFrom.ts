import fs from "node:fs";
import path from "node:path";

export type PathSkipReason = "absolute" | "outside-root" | "missing" | "not-a-file";

export interface ResolvedListedPath {
  /** POSIX-style path relative to the pack root. */
  relPath: string;
  absPath: string;
}

export type ResolveListedPathResult =
  | { ok: true; value: ResolvedListedPath }
  | { ok: false; reason: PathSkipReason; listed: string };

/**
 * Parse a `--paths-from` body: one path per line, UTF-8.
 * Trims whitespace; skips empty lines and lines starting with `#`.
 */
export function parsePathList(text: string): string[] {
  const body = text.replace(/^\uFEFF/, "");
  const out: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    out.push(line);
  }
  return out;
}

/**
 * Read `--paths-from` source: a filesystem path, or `-` for stdin.
 */
export function readPathsFromSource(source: string): string {
  if (source === "-") {
    return fs.readFileSync(process.stdin.fd, "utf8");
  }
  return fs.readFileSync(path.resolve(source), "utf8");
}

/**
 * Resolve a listed path against the pack root.
 * Rejects absolute paths and `..` traversal that would leave the root.
 * Does not check whether the file exists.
 */
export function resolveListedPath(absRoot: string, listed: string): ResolveListedPathResult {
  const trimmed = listed.trim();
  if (looksAbsolute(trimmed)) {
    return { ok: false, reason: "absolute", listed: trimmed };
  }

  const absPath = path.resolve(absRoot, trimmed);
  if (isOutsideRoot(absRoot, absPath)) {
    return { ok: false, reason: "outside-root", listed: trimmed };
  }

  const relPath = toPosix(path.relative(absRoot, absPath));
  if (!relPath || relPath === ".") {
    return { ok: false, reason: "outside-root", listed: trimmed };
  }

  return { ok: true, value: { relPath, absPath } };
}

export function skipNote(reason: PathSkipReason, listed: string): string {
  switch (reason) {
    case "absolute":
      return `skipping absolute path: ${listed}`;
    case "outside-root":
      return `skipping path outside root: ${listed}`;
    case "missing":
      return `skipping missing path: ${listed}`;
    case "not-a-file":
      return `skipping not a file: ${listed}`;
  }
}

function looksAbsolute(p: string): boolean {
  if (path.isAbsolute(p)) return true;
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith("//") || p.startsWith("\\\\")) return true;
  return false;
}

function isOutsideRoot(absRoot: string, absPath: string): boolean {
  const rel = path.relative(absRoot, absPath);
  if (rel === "") return true;
  const posix = rel.split(path.sep).join("/");
  return posix === ".." || posix.startsWith("../") || path.isAbsolute(rel);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
