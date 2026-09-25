import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { formatInitSummary, InitError, runInit } from "../src/init/init.js";
import {
  AGENTS_REL,
  AGENTS_SECTION_START,
  CURSOR_RULE_REL,
  PR_REVIEW_RECIPE,
  PREFERRED_INVOKE,
  SEARCH_RECIPE,
  SKILL_REL,
} from "../src/init/templates.js";

const temps: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-init-"));
  temps.push(dir);
  return dir;
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

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function expectAccurateTemplates(text: string): void {
  expect(text).toContain("@shree_vitkar/contextpack");
  expect(text).toContain("contextpack");
  expect(text).toContain(PREFERRED_INVOKE);
  expect(text).toContain(PR_REVIEW_RECIPE);
  expect(text).toContain(SEARCH_RECIPE);
  expect(text).toContain("--list");
  expect(text).toContain("--since");
  expect(text).toContain("--diff");
  expect(text).toContain("--paths-from -");
  expect(text).toContain("--format json");
  expect(text).toContain("-o");
  expect(text).toContain("--no-redact");
  expect(text.toLowerCase()).toMatch(/chars\s*\/\s*4|characters\s*\/\s*4/);
  expect(text).not.toMatch(/--watch\b/);
  expect(text).not.toMatch(/--tokens\b/);
  expect(text).not.toMatch(/--model\b/);
}

describe("runInit", () => {
  it("writes Cursor rule and skill when missing", () => {
    const root = tmpDir();
    const result = runInit(root);

    expect(result.files.map((f) => f.action)).toEqual(["created", "created"]);
    expect(fs.existsSync(path.join(root, CURSOR_RULE_REL))).toBe(true);
    expect(fs.existsSync(path.join(root, SKILL_REL))).toBe(true);
    expect(fs.existsSync(path.join(root, AGENTS_REL))).toBe(false);

    const rule = read(root, CURSOR_RULE_REL);
    const skill = read(root, SKILL_REL);
    expect(rule.startsWith("---\n")).toBe(true);
    expect(rule).toContain("alwaysApply: false");
    expect(skill).toMatch(/^---\nname: contextpack\n/);
    expect(skill).toMatch(/description: Use this when/i);
    expectAccurateTemplates(rule);
    expectAccurateTemplates(skill);
  });

  it("does not overwrite existing files without --force", () => {
    const root = tmpDir();
    runInit(root);
    fs.writeFileSync(path.join(root, CURSOR_RULE_REL), "KEEP-RULE\n", "utf8");
    fs.writeFileSync(path.join(root, SKILL_REL), "KEEP-SKILL\n", "utf8");

    const result = runInit(root);
    expect(result.files.every((f) => f.action === "skipped")).toBe(true);
    expect(read(root, CURSOR_RULE_REL)).toBe("KEEP-RULE\n");
    expect(read(root, SKILL_REL)).toBe("KEEP-SKILL\n");
  });

  it("overwrites existing files with --force", () => {
    const root = tmpDir();
    runInit(root);
    fs.writeFileSync(path.join(root, CURSOR_RULE_REL), "OLD-RULE\n", "utf8");
    fs.writeFileSync(path.join(root, SKILL_REL), "OLD-SKILL\n", "utf8");

    const result = runInit(root, { force: true });
    expect(result.files.every((f) => f.action === "overwritten")).toBe(true);
    expect(read(root, CURSOR_RULE_REL)).toContain(PREFERRED_INVOKE);
    expect(read(root, SKILL_REL)).toContain("name: contextpack");
    expect(read(root, CURSOR_RULE_REL)).not.toContain("OLD-RULE");
  });

  it("creates a minimal AGENTS.md with --agents", () => {
    const root = tmpDir();
    const result = runInit(root, { agents: true });

    const agents = result.files.find((f) => f.relativePath === AGENTS_REL);
    expect(agents?.action).toBe("created");
    const text = read(root, AGENTS_REL);
    expect(text.startsWith("# Agent instructions")).toBe(true);
    expect(text).toContain(AGENTS_SECTION_START);
    expectAccurateTemplates(text);
  });

  it("appends a section when AGENTS.md already exists", () => {
    const root = tmpDir();
    const original = "# Existing agents\n\nDo not lose this.\n";
    fs.writeFileSync(path.join(root, AGENTS_REL), original, "utf8");

    const result = runInit(root, { agents: true });
    const agents = result.files.find((f) => f.relativePath === AGENTS_REL);
    expect(agents?.action).toBe("appended");

    const text = read(root, AGENTS_REL);
    expect(text.startsWith("# Existing agents")).toBe(true);
    expect(text).toContain("Do not lose this.");
    expect(text).toContain(AGENTS_SECTION_START);
    expect(text).toContain(PREFERRED_INVOKE);
  });

  it("does not duplicate an existing AGENTS.md section without --force", () => {
    const root = tmpDir();
    runInit(root, { agents: true });
    const once = read(root, AGENTS_REL);

    const result = runInit(root, { agents: true });
    const agents = result.files.find((f) => f.relativePath === AGENTS_REL);
    expect(agents?.action).toBe("skipped");
    expect(read(root, AGENTS_REL)).toBe(once);
    expect(once.split(AGENTS_SECTION_START)).toHaveLength(2);
  });

  it("creates a missing target directory", () => {
    const root = path.join(tmpDir(), "nested", "repo");
    runInit(root);
    expect(fs.existsSync(path.join(root, CURSOR_RULE_REL))).toBe(true);
  });

  it("throws when the target path is a file", () => {
    const file = path.join(tmpDir(), "not-a-dir");
    fs.writeFileSync(file, "nope", "utf8");
    expect(() => runInit(file)).toThrow(InitError);
    expect(() => runInit(file)).toThrow(/not a directory/);
  });

  it("throws when a parent path exists as a file", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, ".cursor"));
    fs.writeFileSync(path.join(root, ".cursor", "rules"), "legacy file\n", "utf8");
    expect(() => runInit(root)).toThrow(/not a directory/);
  });
});

describe("init CLI", () => {
  it("registers init with --force, --agents, and --quiet", () => {
    const program = createProgram();
    const initCmd = program.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();
    const longs = initCmd!.options.map((o) => o.long);
    expect(longs).toContain("--force");
    expect(longs).toContain("--agents");
    expect(longs).toContain("--quiet");
  });

  it("prints a stderr summary of written files", async () => {
    const root = tmpDir();
    const { stdout, stderr, exitCode } = await runCli(["init", root]);

    expect(exitCode).toBeUndefined();
    expect(stdout).toBe("");
    expect(stderr).toContain("contextpack init:");
    expect(stderr).toContain(`created ${CURSOR_RULE_REL}`);
    expect(stderr).toContain(`created ${SKILL_REL}`);
  });

  it("respects --quiet", async () => {
    const root = tmpDir();
    const { stderr, exitCode } = await runCli(["init", root, "--quiet"]);
    expect(exitCode).toBeUndefined();
    expect(stderr).toBe("");
    expect(fs.existsSync(path.join(root, SKILL_REL))).toBe(true);
  });

  it("exits non-zero for an invalid path", async () => {
    const file = path.join(tmpDir(), "file.txt");
    fs.writeFileSync(file, "x", "utf8");
    const { stderr, exitCode } = await runCli(["init", file]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("error:");
    expect(stderr).toContain("not a directory");
  });

  it("appends AGENTS.md via --agents", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, AGENTS_REL), "# Keep\n", "utf8");
    const { stderr, exitCode } = await runCli(["init", root, "--agents", "--quiet"]);
    expect(exitCode).toBeUndefined();
    expect(stderr).toBe("");
    const text = read(root, AGENTS_REL);
    expect(text).toContain("# Keep");
    expect(text).toContain(PR_REVIEW_RECIPE);
  });
});

describe("formatInitSummary", () => {
  it("lists each file action", () => {
    const summary = formatInitSummary({
      root: "/tmp",
      files: [
        { relativePath: CURSOR_RULE_REL, action: "created" },
        { relativePath: SKILL_REL, action: "skipped" },
      ],
    });
    expect(summary).toBe(
      `contextpack init: created ${CURSOR_RULE_REL} · skipped ${SKILL_REL} (exists)`,
    );
  });
});
