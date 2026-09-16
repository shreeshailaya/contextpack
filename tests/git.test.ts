import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { pack } from "../src/pack/pack.js";
import { getChangedFilesSince, getUnifiedDiffs, isGitAvailable, findGitRoot } from "../src/pack/git.js";
import { collectFiles } from "../src/pack/collect.js";
import { formatList, formatPack } from "../src/pack/format.js";

const temps: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-git-"));
  temps.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function initGitRepo(dir: string): void {
  git(dir, "init");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test User");
}

function writeFile(dir: string, relPath: string, content: string): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("git helpers", () => {
  it("isGitAvailable returns true when git is installed", () => {
    expect(isGitAvailable()).toBe(true);
  });

  it("findGitRoot returns root for a git repo", () => {
    const dir = tmpDir();
    initGitRepo(dir);
    const root = findGitRoot(dir);
    expect(root).toBe(dir);
  });

  it("findGitRoot returns null for non-repo", () => {
    const dir = tmpDir();
    const root = findGitRoot(dir);
    expect(root).toBeNull();
  });
});

describe("getChangedFilesSince", () => {
  it("returns changed files since a ref", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "initial.txt", "initial content");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "changed.txt", "new file");
    writeFile(dir, "initial.txt", "modified content");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "changes");

    const result = getChangedFilesSince(dir, "HEAD~1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files.has("changed.txt")).toBe(true);
      expect(result.value.files.has("initial.txt")).toBe(true);
    }
  });

  it("includes untracked files", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "committed.txt", "committed");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "untracked.txt", "untracked content");

    const result = getChangedFilesSince(dir, "HEAD");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files.has("untracked.txt")).toBe(true);
      expect(result.value.files.has("committed.txt")).toBe(false);
    }
  });

  it("returns error for non-repo", () => {
    const dir = tmpDir();
    const result = getChangedFilesSince(dir, "main");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_GIT_REPO");
    }
  });

  it("returns error for invalid ref", () => {
    const dir = tmpDir();
    initGitRepo(dir);
    writeFile(dir, "file.txt", "content");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    const result = getChangedFilesSince(dir, "nonexistent-branch");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_REF");
    }
  });
});

describe("collectFiles with --since", () => {
  it("filters files to only changed ones", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "old.txt", "old file");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "new.txt", "new file");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "add new");

    const result = collectFiles(dir, { since: "HEAD~1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.value.files.map((f) => f.relPath);
      expect(paths).toContain("new.txt");
      expect(paths).not.toContain("old.txt");
    }
  });

  it("returns error when since is set but not in git repo", () => {
    const dir = tmpDir();
    writeFile(dir, "file.txt", "content");

    const result = collectFiles(dir, { since: "main" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_GIT_REPO");
    }
  });

  it("combines with ignore patterns", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "keep.txt", "keep");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "src/app.ts", "app code");
    writeFile(dir, "tests/app.test.ts", "test code");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "add src and tests");

    const result = collectFiles(dir, { since: "HEAD~1", ignore: ["tests/**"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.value.files.map((f) => f.relPath);
      expect(paths).toContain("src/app.ts");
      expect(paths).not.toContain("tests/app.test.ts");
    }
  });
});

describe("pack with --since", () => {
  it("packs only changed files", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "README.md", "# Old readme");
    writeFile(dir, "old.ts", "export const old = 1;");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "new.ts", "export const new = 2;");
    writeFile(dir, "README.md", "# Updated readme");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "changes");

    const result = pack(dir, { since: "HEAD~1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.value.files.map((f) => f.path);
      expect(paths).toContain("new.ts");
      expect(paths).toContain("README.md");
      expect(paths).not.toContain("old.ts");
    }
  });

  it("returns error for invalid ref", () => {
    const dir = tmpDir();
    initGitRepo(dir);
    writeFile(dir, "file.txt", "content");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    const result = pack(dir, { since: "nonexistent" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("invalid git ref");
    }
  });

  it("returns error for non-git directory", () => {
    const dir = tmpDir();
    writeFile(dir, "file.txt", "content");

    const result = pack(dir, { since: "main" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("not inside a git repository");
    }
  });

  it("works with budget", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "old.txt", "old");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "small.ts", "x");
    writeFile(dir, "large.ts", "y".repeat(1000));
    git(dir, "add", ".");
    git(dir, "commit", "-m", "add files");

    const result = pack(dir, { since: "HEAD~1", budget: 50 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stats.included).toBeGreaterThan(0);
      expect(result.value.budget).toBe(50);
    }
  });

  it("includes untracked files in working tree", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "committed.txt", "committed");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "untracked.ts", "export const untracked = true;");

    const result = pack(dir, { since: "HEAD" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.value.files.map((f) => f.path);
      expect(paths).toContain("untracked.ts");
    }
  });
});

describe("pack with --since --diff", () => {
  it("packs a modified file as a unified diff", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "app.ts", "const x = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "app.ts", "const x = 2;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "change x");

    const result = pack(dir, { since: "HEAD~1", diff: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const app = result.value.files.find((f) => f.path === "app.ts");
    expect(app).toBeDefined();
    expect(app!.kind).toBe("diff");
    expect(app!.content).toContain("diff --git");
    expect(app!.content).toContain("@@");
    expect(app!.content).toContain("-const x = 1;");
    expect(app!.content).toContain("+const x = 2;");
    expect(app!.content).not.toBe("const x = 2;\n");
  });

  it("packs untracked files as full content", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "committed.ts", "export const committed = true;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "new.ts", "export const fresh = true;\n");

    const result = pack(dir, { since: "HEAD", diff: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fresh = result.value.files.find((f) => f.path === "new.ts");
    expect(fresh).toBeDefined();
    expect(fresh!.kind).toBe("file");
    expect(fresh!.content).toBe("export const fresh = true;\n");
    expect(fresh!.content).not.toContain("diff --git");
  });

  it("returns an error when --diff is set without --since", () => {
    const dir = tmpDir();
    initGitRepo(dir);
    writeFile(dir, "file.ts", "export {};\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    const result = pack(dir, { diff: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("--diff requires --since");
    }
  });

  it("--list --since --diff still previews the changed file set", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "old.ts", "export const old = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "old.ts", "export const old = 2;\n");
    writeFile(dir, "added.ts", "export const added = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "changes");
    writeFile(dir, "untracked.ts", "export const untracked = 1;\n");

    const result = pack(dir, { since: "HEAD~1", diff: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).toContain("old.ts");
    expect(paths).toContain("added.ts");
    expect(paths).toContain("untracked.ts");
    expect(paths).not.toContain("README.md");

    const preview = formatList(result.value, "plain");
    expect(preview).toContain("old.ts");
    expect(preview).toContain("added.ts");
    expect(preview).toContain("untracked.ts");
    expect(preview).not.toContain("export const old");
    expect(preview).not.toContain("diff --git");

    const jsonPreview = JSON.parse(formatList(result.value, "json")) as {
      entries: { path: string; kind: string }[];
    };
    expect(jsonPreview.entries.find((e) => e.path === "old.ts")?.kind).toBe("diff");
    expect(jsonPreview.entries.find((e) => e.path === "untracked.ts")?.kind).toBe("file");
  });

  it("fences diffs as diff in markdown and exposes kind in JSON", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "app.ts", "const x = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "app.ts", "const x = 2;\n");
    writeFile(dir, "new.ts", "export const n = 1;\n");

    const result = pack(dir, { since: "HEAD", diff: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const md = formatPack(result.value, "md");
    expect(md).toContain("```diff");
    expect(md).toContain("[diff]");
    expect(md).toContain("## app.ts [diff]");
    expect(md).toContain("## new.ts");
    expect(md).not.toContain("## new.ts [diff]");

    const parsed = JSON.parse(formatPack(result.value, "json")) as {
      files: { path: string; kind: string; content: string }[];
    };
    expect(parsed.files.find((f) => f.path === "app.ts")?.kind).toBe("diff");
    expect(parsed.files.find((f) => f.path === "new.ts")?.kind).toBe("file");
    expect(parsed.files.find((f) => f.path === "new.ts")?.content).toBe("export const n = 1;\n");
  });

  it("scopes diffs to a subdirectory pack root in a monorepo", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "pkg/app.ts", "const x = 1;\n");
    writeFile(dir, "other/skip.ts", "const y = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "pkg/app.ts", "const x = 2;\n");
    writeFile(dir, "other/skip.ts", "const y = 2;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "changes");

    const packRoot = path.join(dir, "pkg");
    const result = pack(packRoot, { since: "HEAD~1", diff: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("skip.ts");
    expect(paths.some((p) => p.includes("other"))).toBe(false);

    const app = result.value.files.find((f) => f.path === "app.ts");
    expect(app?.kind).toBe("diff");
    expect(app?.content).toContain("-const x = 1;");
    expect(app?.content).toContain("+const x = 2;");
  });
});

describe("getUnifiedDiffs", () => {
  it("returns a path-scoped unified diff mapped by absolute path", () => {
    const dir = tmpDir();
    initGitRepo(dir);

    writeFile(dir, "src/a.ts", "const a = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    writeFile(dir, "src/a.ts", "const a = 2;\n");

    const abs = path.join(dir, "src/a.ts");
    const result = getUnifiedDiffs(dir, "HEAD", [abs]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const diff = result.value.get(abs);
    expect(diff).toBeDefined();
    expect(diff).toContain("diff --git");
    expect(diff).toContain("-const a = 1;");
    expect(diff).toContain("+const a = 2;");
  });
});
