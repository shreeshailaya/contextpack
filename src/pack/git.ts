import { execSync, spawnSync } from "node:child_process";
import path from "node:path";

export interface GitChangedFilesResult {
  files: Set<string>;
  gitRoot: string;
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
          files.add(toPosix(relToPackRoot));
        }
      }
    }
  } catch {
    // Silently ignore untracked file errors - tracked diff is the primary feature
  }

  return {
    ok: true,
    value: { files, gitRoot },
  };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
