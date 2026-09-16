import { execSync, spawnSync } from "node:child_process";
import path from "node:path";

export interface GitChangedFilesResult {
  /** Changed tracked + untracked paths, relative to the pack root (POSIX). */
  files: Set<string>;
  gitRoot: string;
  /** Untracked paths (subset of `files`), relative to the pack root (POSIX). */
  untracked: Set<string>;
}

export interface GitError {
  code: "NOT_GIT_REPO" | "INVALID_REF" | "GIT_NOT_FOUND" | "GIT_ERROR";
  message: string;
}

export type GitResult<T> = { ok: true; value: T } | { ok: false; error: GitError };

/**
 * Check if git is available on the system.
 */
export function isGitAvailable(): boolean {
  try {
    const result = spawnSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Find the git repository root for a given directory.
 * Returns null if the directory is not inside a git repo.
 */
export function findGitRoot(dir: string): string | null {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Validate that a git ref exists.
 */
export function isValidGitRef(ref: string, cwd: string): boolean {
  try {
    const result = spawnSync("git", ["rev-parse", "--verify", ref], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get files changed since a git ref (modified, added).
 * Also includes untracked files under the pack root.
 *
 * Returns relative paths (POSIX-style) from the pack root.
 */
export function getChangedFilesSince(
  packRoot: string,
  ref: string,
): GitResult<GitChangedFilesResult> {
  const absPackRoot = path.resolve(packRoot);

  if (!isGitAvailable()) {
    return {
      ok: false,
      error: {
        code: "GIT_NOT_FOUND",
        message: "git is not available on this system",
      },
    };
  }

  const gitRoot = findGitRoot(absPackRoot);
  if (!gitRoot) {
    return {
      ok: false,
      error: {
        code: "NOT_GIT_REPO",
        message: `${absPackRoot} is not inside a git repository`,
      },
    };
  }

  if (!isValidGitRef(ref, gitRoot)) {
    return {
      ok: false,
      error: {
        code: "INVALID_REF",
        message: `invalid git ref: ${ref}`,
      },
    };
  }

  const files = new Set<string>();
  const untracked = new Set<string>();

  try {
    const diffResult = spawnSync(
      "git",
      ["diff", "--name-only", ref, "--", absPackRoot],
      {
        cwd: gitRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    if (diffResult.status !== 0) {
      return {
        ok: false,
        error: {
          code: "GIT_ERROR",
          message: `git diff failed: ${diffResult.stderr || "unknown error"}`,
        },
      };
    }

    const diffFiles = diffResult.stdout.trim().split("\n").filter(Boolean);
    for (const file of diffFiles) {
      const absFile = path.join(gitRoot, file);
      const relToPackRoot = path.relative(absPackRoot, absFile);
      if (!relToPackRoot.startsWith("..") && relToPackRoot !== "") {
        files.add(toPosix(relToPackRoot));
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "GIT_ERROR",
        message: `git diff failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  try {
    const untrackedResult = spawnSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "--", absPackRoot],
      {
        cwd: gitRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    if (untrackedResult.status === 0) {
      const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);
      for (const file of untrackedFiles) {
        const absFile = path.join(gitRoot, file);
        const relToPackRoot = path.relative(absPackRoot, absFile);
        if (!relToPackRoot.startsWith("..") && relToPackRoot !== "") {
          const posix = toPosix(relToPackRoot);
          files.add(posix);
          untracked.add(posix);
        }
      }
    }
  } catch {
    // Silently ignore untracked file errors - tracked diff is the primary feature
  }

  return {
    ok: true,
    value: { files, gitRoot, untracked },
  };
}

const DIFF_CHUNK_SIZE = 100;

/**
 * Get unified diffs for tracked files since `ref`.
 *
 * Keys are absolute file paths. Files with empty diffs are omitted.
 * Uses path-scoped `git diff <ref> -- <files>` from the git root so pack
 * roots that are subdirectories of a monorepo stay correct.
 */
export function getUnifiedDiffs(
  gitRoot: string,
  ref: string,
  absPaths: string[],
): GitResult<Map<string, string>> {
  const resultMap = new Map<string, string>();
  if (absPaths.length === 0) {
    return { ok: true, value: resultMap };
  }

  for (let i = 0; i < absPaths.length; i += DIFF_CHUNK_SIZE) {
    const chunk = absPaths.slice(i, i + DIFF_CHUNK_SIZE);
    const spawned = spawnSync("git", ["diff", ref, "--", ...chunk], {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });

    if (spawned.status !== 0) {
      return {
        ok: false,
        error: {
          code: "GIT_ERROR",
          message: `git diff failed: ${spawned.stderr || "unknown error"}`,
        },
      };
    }

    const parsed = splitDiffsByGitPath(spawned.stdout);
    for (const abs of chunk) {
      const gitRel = toPosix(path.relative(gitRoot, abs));
      const diff = parsed.get(gitRel);
      if (diff) {
        resultMap.set(abs, diff);
      }
    }
  }

  return { ok: true, value: resultMap };
}

function splitDiffsByGitPath(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!stdout) return map;

  const chunks = stdout.split(/(?=^diff --git )/m);
  for (const chunk of chunks) {
    if (!chunk.startsWith("diff --git ")) continue;
    const gitPath = parseDiffGitPath(chunk);
    if (gitPath) {
      map.set(gitPath, chunk.endsWith("\n") ? chunk : `${chunk}\n`);
    }
  }
  return map;
}

function parseDiffGitPath(chunk: string): string | null {
  const plus = chunk.match(/^\+\+\+ b\/(.*)$/m);
  if (plus?.[1]) {
    return unquoteGitPath(plus[1].trim());
  }

  const header = chunk.match(/^diff --git (?:")?a\/(.+?)(?:")? (?:")?b\/(.+?)(?:")?$/m);
  if (header?.[2]) {
    return unquoteGitPath(header[2].trim());
  }

  return null;
}

function unquoteGitPath(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    return p
      .slice(1, -1)
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"');
  }
  return p;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
