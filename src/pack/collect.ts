import fs from "node:fs";
import path from "node:path";
import ignoreImport from "ignore";
import type { Ignore } from "ignore";

// ignore CJS default export interop under NodeNext
const ignore = ignoreImport as unknown as (options?: { ignoreCase?: boolean }) => Ignore;
import { DEFAULT_IGNORES, TEXT_BASENAMES, TEXT_EXTENSIONS } from "../ignore/defaults.js";
import { getChangedFilesSince } from "./git.js";
import { resolveListedPath, skipNote } from "./pathsFrom.js";
import type { CollectOptions, PackedFileKind } from "../types.js";

const DEFAULT_MAX_FILE_BYTES = 512 * 1024; // 512 KiB

export interface CollectedFile {
  /** Relative POSIX-style path from root. */
  relPath: string;
  absPath: string;
  size: number;
  /** Precomputed content (e.g. a unified diff). Budget uses this instead of reading the file. */
  content?: string;
  /** Full file body vs unified diff. */
  kind?: PackedFileKind;
}

export interface CollectResult {
  files: CollectedFile[];
  ignoredCount: number;
  /** Stderr-worthy skip notes from `--paths-from` (missing, absolute, outside root). */
  notes: string[];
  /** Present when `--since` successfully resolved a git repo. */
  git?: {
    gitRoot: string;
    untracked: Set<string>;
  };
}

export interface CollectError {
  code: string;
  message: string;
}

export type CollectReturn = 
  | { ok: true; value: CollectResult }
  | { ok: false; error: CollectError };

/**
 * Optional ignore files loaded from the pack root (not nested directories),
 * in layer order after DEFAULT_IGNORES and before CLI `--ignore`.
 * Missing or unreadable files are skipped.
 */
export const ROOT_IGNORE_FILES = [
  ".gitignore",
  ".cursorignore",
  ".aiignore",
  ".copilotignore",
] as const;

/**
 * Discover candidate text files, respecting:
 * - DEFAULT_IGNORES
 * - root `.gitignore` / `.cursorignore` / `.aiignore` / `.copilotignore` (if present)
 * - extra `--ignore` patterns
 * - `--include` patterns that force-include matched paths
 * - `--since` git ref filtering (only files changed since ref)
 * - `--paths-from` explicit path list (no tree walk; intersected with `--since` when both are set)
 *
 * If `options.since` is set and git operations fail, returns an error result.
 */
export function collectFiles(root: string, options: CollectOptions = {}): CollectReturn {
  const absRoot = path.resolve(root);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  let changedFiles: Set<string> | null = null;
  let git: CollectResult["git"];
  if (options.since) {
    const gitResult = getChangedFilesSince(absRoot, options.since);
    if (!gitResult.ok) {
      return {
        ok: false,
        error: {
          code: gitResult.error.code,
          message: gitResult.error.message,
        },
      };
    }
    changedFiles = gitResult.value.files;
    git = {
      gitRoot: gitResult.value.gitRoot,
      untracked: gitResult.value.untracked,
    };
  }

  const ig = ignore();
  ig.add([...DEFAULT_IGNORES]);

  for (const name of ROOT_IGNORE_FILES) {
    addIgnoreFile(ig, absRoot, name);
  }

  if (options.ignore?.length) {
    ig.add(options.ignore);
  }

  const forceInclude = options.include?.length
    ? ignore().add(options.include)
    : null;

  const files: CollectedFile[] = [];
  let ignoredCount = 0;
  const notes: string[] = [];
  const onIgnored = (n: number) => {
    ignoredCount += n;
  };

  if (options.paths) {
    collectListedPaths(
      absRoot,
      options.paths,
      ig,
      forceInclude,
      maxFileBytes,
      changedFiles,
      files,
      onIgnored,
      notes,
    );
  } else {
    walk(absRoot, absRoot, ig, forceInclude, maxFileBytes, changedFiles, files, onIgnored);
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { ok: true, value: { files, ignoredCount, notes, git } };
}

/**
 * Resolve only the given paths under `absRoot` (no tree walk).
 * Invalid / missing paths are skipped with a note; ignore and `--since`
 * filters still apply. Empty intersection with `--since` is success.
 */
function collectListedPaths(
  absRoot: string,
  listedPaths: string[],
  ig: Ignore,
  forceInclude: Ignore | null,
  maxFileBytes: number,
  changedFiles: Set<string> | null,
  out: CollectedFile[],
  onIgnored: (n: number) => void,
  notes: string[],
): void {
  const seen = new Set<string>();

  for (const listed of listedPaths) {
    const resolved = resolveListedPath(absRoot, listed);
    if (!resolved.ok) {
      notes.push(skipNote(resolved.reason, resolved.listed));
      continue;
    }

    const { relPath, absPath } = resolved.value;
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    let st: fs.Stats;
    try {
      st = fs.lstatSync(absPath);
    } catch {
      notes.push(skipNote("missing", listed));
      continue;
    }

    if (st.isSymbolicLink() || !st.isFile()) {
      notes.push(skipNote("not-a-file", listed));
      continue;
    }

    considerFile(absPath, relPath, ig, forceInclude, maxFileBytes, changedFiles, out, onIgnored);
  }
}

/** Apply ignore / since / size / text filters and maybe push a collected file. */
function considerFile(
  abs: string,
  rel: string,
  ig: Ignore,
  forceInclude: Ignore | null,
  maxFileBytes: number,
  changedFiles: Set<string> | null,
  out: CollectedFile[],
  onIgnored: (n: number) => void,
): void {
  const forced = forceInclude?.ignores(rel) ?? false;
  const ignored = !forced && ig.ignores(rel);
  if (ignored) {
    onIgnored(1);
    return;
  }

  if (changedFiles && !changedFiles.has(rel)) {
    return;
  }

  let size = 0;
  try {
    const st = fs.statSync(abs);
    size = st.size;
    if (size > maxFileBytes) {
      onIgnored(1);
      return;
    }
  } catch {
    onIgnored(1);
    return;
  }

  if (!looksLikeText(rel, abs) && !forced) {
    onIgnored(1);
    return;
  }

  out.push({ relPath: rel, absPath: abs, size });
}

/** Load one gitignore-syntax file from the pack root; skip if missing or unreadable. */
function addIgnoreFile(ig: Ignore, absRoot: string, filename: string): void {
  const filePath = path.join(absRoot, filename);
  if (!fs.existsSync(filePath)) return;
  try {
    ig.add(fs.readFileSync(filePath, "utf8"));
  } catch {
    // skip unreadable ignore files (same as .gitignore)
  }
}

function walk(
  absRoot: string,
  dir: string,
  ig: Ignore,
  forceInclude: Ignore | null,
  maxFileBytes: number,
  changedFiles: Set<string> | null,
  out: CollectedFile[],
  onIgnored: (n: number) => void,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = toPosix(path.relative(absRoot, abs));
    if (!rel || rel === ".") continue;

    const relForIgnore = entry.isDirectory() ? `${rel}/` : rel;
    const forced = forceInclude?.ignores(rel) ?? false;
    const ignored = !forced && ig.ignores(relForIgnore);

    if (entry.isDirectory()) {
      try {
        if (fs.lstatSync(abs).isSymbolicLink()) {
          onIgnored(1);
          continue;
        }
      } catch {
        continue;
      }

      // If the directory itself is ignored, still descend when force-include is
      // active so paths like vendor/lib.js can be recovered via --include.
      // Also descend when changedFiles is set — changed files may be nested.
      if (ignored && !forceInclude && !changedFiles) {
        onIgnored(1);
        continue;
      }

      walk(absRoot, abs, ig, forceInclude, maxFileBytes, changedFiles, out, onIgnored);
      continue;
    }

    if (!entry.isFile()) {
      onIgnored(1);
      continue;
    }

    considerFile(abs, rel, ig, forceInclude, maxFileBytes, changedFiles, out, onIgnored);
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function looksLikeText(relPath: string, absPath: string): boolean {
  const base = path.basename(relPath);
  const ext = path.extname(relPath).toLowerCase();

  if (TEXT_BASENAMES.has(base)) return true;
  if (/^(readme|license|licence|changelog|contributing)/i.test(base)) return true;
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext && isProbablyTextFile(absPath)) return true;
  return false;
}

/** Heuristic: sample first bytes; reject if NUL or too many non-text bytes. */
function isProbablyTextFile(absPath: string): boolean {
  try {
    const fd = fs.openSync(absPath, "r");
    const buf = Buffer.alloc(8000);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (n === 0) return true;
    const sample = buf.subarray(0, n);
    if (sample.includes(0)) return false;
    let weird = 0;
    for (let i = 0; i < sample.length; i++) {
      const c = sample[i]!;
      if (c === 9 || c === 10 || c === 13) continue;
      if (c < 32) weird++;
    }
    return weird / sample.length < 0.05;
  } catch {
    return false;
  }
}

/** Read file as UTF-8; return null if binary-ish or unreadable. */
export function readTextFile(absPath: string): string | null {
  try {
    const buf = fs.readFileSync(absPath);
    if (buf.includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}
