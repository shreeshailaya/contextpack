import fs from "node:fs";
import path from "node:path";
import { TEXT_BASENAMES, TEXT_EXTENSIONS } from "../ignore/defaults.js";
import { estimateTokens } from "./tokens.js";

/**
 * Naive dump: concatenate/sum every text-ish file under a tree.
 *
 * "Naive" is defined as the dump people actually do (`find … -exec cat`) —
 * not a second packer. Explicitly **no**:
 *   - `.gitignore`
 *   - `DEFAULT_IGNORES` (node_modules, vendor, lockfiles, build, secrets, …)
 *   - priority ranking
 *   - token budget
 *
 * Still skipped, because they are not "dump the source":
 *   - `.git/` (opaque VCS objects)
 *   - directories, non-files, and symlinks
 *   - unreadable files
 *   - files containing a NUL byte (not text)
 *
 * Token estimates use the same heuristic as `pack()`: `characters / 4`
 * per file, then summed. That is an estimate, not a model tokenizer.
 */

export interface NaiveFile {
  relPath: string;
  absPath: string;
  bytes: number;
  tokens: number;
}

export interface NaiveDump {
  root: string;
  files: NaiveFile[];
  totalTokens: number;
  fileCount: number;
}

export function naiveDump(root: string): NaiveDump {
  const absRoot = path.resolve(root);
  const files: NaiveFile[] = [];
  walk(absRoot, absRoot, files);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);
  return {
    root: absRoot,
    files,
    totalTokens,
    fileCount: files.length,
  };
}

function walk(absRoot: string, dir: string, out: NaiveFile[]): void {
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

    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      try {
        if (fs.lstatSync(abs).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      walk(absRoot, abs, out);
      continue;
    }

    if (!entry.isFile()) continue;
    try {
      if (fs.lstatSync(abs).isSymbolicLink()) continue;
    } catch {
      continue;
    }

    if (!looksLikeText(rel, abs)) continue;

    const content = readText(abs);
    if (content === null) continue;

    out.push({
      relPath: rel,
      absPath: abs,
      bytes: Buffer.byteLength(content, "utf8"),
      tokens: estimateTokens(content),
    });
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

function readText(absPath: string): string | null {
  try {
    const buf = fs.readFileSync(absPath);
    if (buf.includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}
