import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { collectFiles } from "../src/pack/collect.js";
import { pack } from "../src/pack/pack.js";
import { parsePathList, resolveListedPath } from "../src/pack/pathsFrom.js";

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-paths-from-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
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

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function runCli(
  argv: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const program = createProgram();
  program.exitOverride();

  let stdout = "";
  let stderr = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalError = console.error;
  const prevExit = process.exitCode;
  process.exitCode = undefined;

  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    stdout += chunk.toString();
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    stderr += chunk.toString();
    return true;
  };
  console.error = (...args: unknown[]) => {
    stderr += args.map(String).join(" ") + "\n";
  };

  try {
    await program.parseAsync(["node", "contextpack", ...argv]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr += message;
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalStderr;
    console.error = originalError;
  }

  const exitCode = process.exitCode;
  process.exitCode = prevExit;
  return { stdout, stderr, exitCode };
}

describe("parsePathList", () => {
  it("trims lines and skips blanks and # comments", () => {
    const text = [
      "# heading",
      "",
      "  src/a.ts  ",
      "\t",
      "# another comment",
      "src/b.ts",
      "   # indented comment is still a comment",
      "README.md",
    ].join("\n");

    expect(parsePathList(text)).toEqual(["src/a.ts", "src/b.ts", "README.md"]);
  });

  it("strips a UTF-8 BOM and handles CRLF", () => {
    expect(parsePathList("\uFEFFa.ts\r\n# skip\r\nb.ts\r\n")).toEqual(["a.ts", "b.ts"]);
  });
});

describe("resolveListedPath", () => {
  it("resolves relative paths under the pack root", () => {
    const root = tmpProject({ "src/app.ts": "export {}" });
    const result = resolveListedPath(root, "src/app.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relPath).toBe("src/app.ts");
      expect(result.value.absPath).toBe(path.join(root, "src/app.ts"));
    }
  });

  it("allows .. that stays inside the root", () => {
    const root = tmpProject({ "src/app.ts": "export {}" });
    const result = resolveListedPath(root, "src/../src/app.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relPath).toBe("src/app.ts");
    }
  });

  it("rejects absolute paths", () => {
    const root = tmpProject({ "a.ts": "a" });
    const result = resolveListedPath(root, "/etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("absolute");
  });

  it("rejects .. traversal outside the root", () => {
    const root = tmpProject({ "a.ts": "a" });
    const result = resolveListedPath(root, "../secret.ts");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("outside-root");
  });
});

describe("collectFiles with paths", () => {
  it("collects only listed files and does not walk the rest of the tree", () => {
    const root = tmpProject({
      "keep.ts": "export const keep = 1;",
      "skip.ts": "export const skip = 1;",
      "src/app.ts": "export const app = 1;",
    });

    const result = collectFiles(root, { paths: ["keep.ts", "src/app.ts"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.files.map((f) => f.relPath);
    expect(paths).toEqual(["keep.ts", "src/app.ts"]);
    expect(paths).not.toContain("skip.ts");
  });

  it("skips comments/blanks via parsePathList before collect", () => {
    const root = tmpProject({
      "a.ts": "a",
      "b.ts": "b",
    });
    const listed = parsePathList("# comment\n\na.ts\n");
    const result = collectFiles(root, { paths: listed });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((f) => f.relPath)).toEqual(["a.ts"]);
  });

  it("skips missing paths with a note", () => {
    const root = tmpProject({
      "exists.ts": "export {}",
    });
    const result = collectFiles(root, { paths: ["exists.ts", "gone.ts"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((f) => f.relPath)).toEqual(["exists.ts"]);
    expect(result.value.notes.some((n) => n.includes("missing") && n.includes("gone.ts"))).toBe(
      true,
    );
  });

  it("skips absolute and outside-root paths with notes", () => {
    const root = tmpProject({ "ok.ts": "ok" });
    const result = collectFiles(root, {
      paths: ["ok.ts", "/tmp/x.ts", "../outside.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((f) => f.relPath)).toEqual(["ok.ts"]);
    expect(result.value.notes.some((n) => n.includes("absolute"))).toBe(true);
    expect(result.value.notes.some((n) => n.includes("outside root"))).toBe(true);
  });

  it("still applies default ignores unless --include force-includes", () => {
    const root = tmpProject({
      "keep.ts": "a",
      "vendor/lib.js": "c",
    });

    const ignored = collectFiles(root, { paths: ["keep.ts", "vendor/lib.js"] });
    expect(ignored.ok).toBe(true);
    if (!ignored.ok) return;
    expect(ignored.value.files.map((f) => f.relPath)).toEqual(["keep.ts"]);

    const forced = collectFiles(root, {
      paths: ["keep.ts", "vendor/lib.js"],
      include: ["vendor/lib.js"],
    });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.value.files.map((f) => f.relPath)).toContain("vendor/lib.js");
  });

  it("deduplicates listed paths", () => {
    const root = tmpProject({ "a.ts": "a" });
    const result = collectFiles(root, { paths: ["a.ts", "a.ts", "./a.ts"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files).toHaveLength(1);
  });
});

describe("pack with paths", () => {
  it("packs only listed files", () => {
    const root = tmpProject({
      "keep.ts": "export const keep = true;\n",
      "other.ts": "export const other = true;\n",
    });
    const result = pack(root, { paths: ["keep.ts"] });
    expect(result.files.map((f) => f.path)).toEqual(["keep.ts"]);
    expect(result.files[0]?.content).toContain("keep");
  });

  it("still applies a token budget", () => {
    const root = tmpProject({
      "README.md": "# Header\n",
      "big.txt": "x".repeat(8000),
    });
    const result = pack(root, { paths: ["README.md", "big.txt"], budget: 100 });
    expect(result.budget).toBe(100);
    expect(result.stats.included).toBeGreaterThan(0);
    expect(result.truncated.length + result.files.filter((f) => f.partial).length).toBeGreaterThan(
      0,
    );
    expect(result.files.every((f) => f.path === "README.md" || f.path === "big.txt")).toBe(true);
  });
});

describe("paths ∩ --since", () => {
  it("packs the intersection of the list and files changed since the ref", () => {
    const dir = tmpProject({
      "old.ts": "export const old = 1;\n",
      "keep.ts": "export const keep = 1;\n",
    });
    initGitRepo(dir);
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    fs.writeFileSync(path.join(dir, "keep.ts"), "export const keep = 2;\n");
    fs.writeFileSync(path.join(dir, "changed.ts"), "export const changed = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "changes");

    const result = pack(dir, { paths: ["keep.ts", "old.ts"], since: "HEAD~1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.files.map((f) => f.path);
    expect(paths).toContain("keep.ts");
    expect(paths).not.toContain("old.ts");
    expect(paths).not.toContain("changed.ts");
  });

  it("empty intersection is a successful empty pack", () => {
    const dir = tmpProject({
      "stable.ts": "export const stable = 1;\n",
    });
    initGitRepo(dir);
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    fs.writeFileSync(path.join(dir, "other.ts"), "export const other = 1;\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "add other");

    const result = pack(dir, { paths: ["stable.ts"], since: "HEAD~1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files).toEqual([]);
    expect(result.value.stats.included).toBe(0);
  });

  it("with --diff, intersecting tracked files are diffs and untracked stay full content", () => {
    const dir = tmpProject({
      "tracked.ts": "export const v = 1;\n",
    });
    initGitRepo(dir);
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    fs.writeFileSync(path.join(dir, "tracked.ts"), "export const v = 2;\n");
    fs.writeFileSync(path.join(dir, "fresh.ts"), "export const fresh = true;\n");

    const result = pack(dir, {
      paths: ["tracked.ts", "fresh.ts", "unrelated.ts"],
      since: "HEAD",
      diff: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tracked = result.value.files.find((f) => f.path === "tracked.ts");
    const fresh = result.value.files.find((f) => f.path === "fresh.ts");
    expect(tracked?.kind).toBe("diff");
    expect(tracked?.content).toContain("diff --git");
    expect(fresh?.kind).toBe("file");
    expect(fresh?.content).toBe("export const fresh = true;\n");
    expect(result.value.files.map((f) => f.path)).not.toContain("unrelated.ts");
  });
});

describe("CLI --paths-from", () => {
  it("has the flag on pack", () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    const opt = packCmd?.options.find((o) => o.long === "--paths-from");
    expect(opt).toBeDefined();
  });

  it("packs from a temp file of paths", async () => {
    const root = tmpProject({
      "keep.ts": "export const keep = 1;\n",
      "skip.ts": "export const skip = 1;\n",
      "src/app.ts": "export const app = 1;\n",
    });
    const listFile = path.join(root, "paths.txt");
    fs.writeFileSync(
      listFile,
      ["# comment", "", "keep.ts", "src/app.ts", "missing.ts"].join("\n"),
      "utf8",
    );

    const { stdout, stderr, exitCode } = await runCli([
      "pack",
      root,
      "--paths-from",
      listFile,
      "--budget",
      "0",
      "-q",
    ]);

    expect(exitCode).toBeUndefined();
    expect(stdout).toContain("keep.ts");
    expect(stdout).toContain("src/app.ts");
    expect(stdout).not.toContain("export const skip");
    expect(stdout).not.toContain("## skip.ts");
    expect(stderr).not.toContain("missing");
  });

  it("notes missing paths on stderr unless --quiet", async () => {
    const root = tmpProject({ "a.ts": "export const a = 1;\n" });
    const listFile = path.join(root, "paths.txt");
    fs.writeFileSync(listFile, "a.ts\nnope.ts\n", "utf8");

    const noisy = await runCli(["pack", root, "--paths-from", listFile, "--budget", "0"]);
    expect(noisy.stderr).toContain("missing");
    expect(noisy.stderr).toContain("nope.ts");
    expect(noisy.stdout).toContain("a.ts");

    const quiet = await runCli(["pack", root, "--paths-from", listFile, "--budget", "0", "-q"]);
    expect(quiet.stderr).not.toContain("missing");
  });

  it("works with --list", async () => {
    const root = tmpProject({
      "keep.ts": "export const keep = 1;\n",
      "skip.ts": "export const skip = 1;\n",
    });
    const listFile = path.join(root, "paths.txt");
    fs.writeFileSync(listFile, "keep.ts\n", "utf8");

    const { stdout } = await runCli(["pack", root, "--paths-from", listFile, "--list", "-q"]);
    expect(stdout).toContain("keep.ts");
    expect(stdout).toContain("included");
    expect(stdout).not.toContain("skip.ts");
    expect(stdout).not.toContain("export const keep");
  });

  it("errors when the paths file does not exist", async () => {
    const root = tmpProject({ "a.ts": "a" });
    const { stderr, exitCode } = await runCli([
      "pack",
      root,
      "--paths-from",
      path.join(root, "no-such-list.txt"),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("cannot read --paths-from");
  });

  it("reads stdin when --paths-from is -", () => {
    const root = tmpProject({
      "keep.ts": "export const keep = 1;\n",
      "skip.ts": "export const skip = 1;\n",
    });
    const tsx = path.resolve("node_modules/.bin/tsx");
    const entry = path.resolve("src/index.ts");
    const spawned = spawnSync(
      tsx,
      [entry, "pack", root, "--paths-from", "-", "--list", "-q"],
      {
        input: "# from rg -l\nkeep.ts\n\n",
        encoding: "utf8",
        env: { ...process.env },
      },
    );

    expect(spawned.status).toBe(0);
    expect(spawned.stdout).toContain("keep.ts");
    expect(spawned.stdout).not.toContain("skip.ts");
    expect(spawned.stdout).not.toContain("export const keep");
  });
});
