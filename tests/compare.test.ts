import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import {
  CompareError,
  DEFAULT_COMPARE_BUDGETS,
  compareDirectory,
  formatCompareReport,
  formatCompareTable,
  packLabel,
  savingsPct,
} from "../src/pack/compare.js";

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-compare-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function noisyProject(): string {
  return tmpProject({
    "README.md": "# Demo\n\nA small project.\n",
    "src/index.js": "export const n = 1;\n",
    "package-lock.json": `${JSON.stringify({ name: "demo", lockfileVersion: 3, packages: {} }, null, 2)}\n`,
    "vendor/pad-lib/index.js": `/* vendor noise */\n${"x".repeat(800)}\n`,
  });
}

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

describe("compare helpers", () => {
  it("labels unlimited budget as Pack unlimited (0)", () => {
    expect(packLabel(0)).toBe("Pack unlimited (0)");
    expect(packLabel(500)).toBe("Pack budget 500");
  });

  it("formats savings as a percent of naive tokens", () => {
    expect(savingsPct(1000, 100)).toBe("-90%");
    expect(savingsPct(100, 100)).toBe("0%");
    expect(savingsPct(0, 10)).toBe("n/a");
  });

  it("table includes expected column labels", () => {
    const root = tmpProject({ "a.txt": "hello" });
    const result = compareDirectory(root, { budgets: [0] });
    const table = formatCompareTable(result.naive, result.rows);

    expect(table).toContain("Mode");
    expect(table).toContain("Files");
    expect(table).toContain("~Tokens (est.)");
    expect(table).toContain("vs naive");
    expect(table).toContain("Truncated");
    expect(table).toContain("Partial");
    expect(table).toContain("Naive dump");
    expect(table).toContain("Pack unlimited (0)");
  });
});

describe("compareDirectory", () => {
  it("counts more naive files than a tight pack when DEFAULT_IGNORES noise exists", () => {
    const root = noisyProject();
    const result = compareDirectory(root, { budgets: [500] });
    const packed = result.rows[0]!;

    expect(result.naive.fileCount).toBeGreaterThan(packed.result.stats.included);
    expect(result.naive.files.map((f) => f.relPath)).toEqual(
      expect.arrayContaining(["package-lock.json", "vendor/pad-lib/index.js", "README.md"]),
    );
    expect(packed.result.files.map((f) => f.path)).toContain("README.md");
    expect(packed.result.files.map((f) => f.path)).not.toContain("package-lock.json");
    expect(packed.result.files.map((f) => f.path)).not.toContain("vendor/pad-lib/index.js");
    expect(packed.result.totalTokens).toBeLessThanOrEqual(500);
  });

  it("unlimited pack still drops lockfile/vendor noise and stays sane", () => {
    const root = noisyProject();
    const result = compareDirectory(root, { budgets: [0] });
    const unlimited = result.rows[0]!;

    expect(unlimited.label).toBe("Pack unlimited (0)");
    expect(unlimited.result.budget).toBeNull();
    expect(unlimited.result.stats.truncated).toBe(0);
    expect(unlimited.result.files.some((f) => f.partial)).toBe(false);
    expect(unlimited.result.files.map((f) => f.path)).not.toContain("package-lock.json");
    expect(unlimited.result.files.map((f) => f.path)).not.toContain("vendor/pad-lib/index.js");
    expect(result.naive.fileCount).toBeGreaterThan(unlimited.result.stats.included);
    expect(result.naive.totalTokens).toBeGreaterThan(unlimited.result.totalTokens);
  });

  it("defaults to the same budgets as scripts/benchmark.ts", () => {
    expect(DEFAULT_COMPARE_BUDGETS).toEqual([500, 2000, 0]);
    const root = noisyProject();
    const result = compareDirectory(root);
    expect(result.rows.map((r) => r.budget)).toEqual([500, 2000, 0]);
  });

  it("report header states chars/4 and the naive definition", () => {
    const root = noisyProject();
    const text = formatCompareReport(compareDirectory(root, { budgets: [0] }));
    expect(text).toContain("contextpack compare");
    expect(text).toMatch(/characters \/ 4/);
    expect(text).toContain("NO .gitignore");
    expect(text).toContain("NO default ignores");
    expect(text).toContain("NO ranking");
    expect(text).toContain("NO budget");
    expect(text).toContain("Naive dump");
  });

  it("throws CompareError for a missing path", () => {
    expect(() => compareDirectory(path.join(os.tmpdir(), "contextpack-missing-compare-dir"))).toThrow(
      CompareError,
    );
    expect(() => compareDirectory(path.join(os.tmpdir(), "contextpack-missing-compare-dir"))).toThrow(
      /path not found/,
    );
  });

  it("throws CompareError when the path is a file", () => {
    const root = tmpProject({ "only.txt": "hi" });
    const file = path.join(root, "only.txt");
    expect(() => compareDirectory(file)).toThrow(/not a directory/);
  });
});

describe("CLI compare", () => {
  it("registers the compare command", () => {
    const program = createProgram();
    const cmd = program.commands.find((c) => c.name() === "compare");
    expect(cmd).toBeDefined();
    const budgetOpt = cmd!.options.find((o) => o.long === "--budget");
    expect(budgetOpt).toBeDefined();
    expect(budgetOpt!.short).toBe("-b");
  });

  it("prints the table and exits 0", async () => {
    const root = noisyProject();
    const { stdout, stderr, exitCode } = await runCli(["compare", root]);

    expect(exitCode ?? 0).toBe(0);
    expect(stderr).not.toMatch(/^error:/);
    expect(stdout).toContain("contextpack compare");
    expect(stdout).toContain("Naive dump");
    expect(stdout).toContain("Pack budget 500");
    expect(stdout).toContain("Pack budget 2000");
    expect(stdout).toContain("Pack unlimited (0)");
    expect(stdout).toContain("~Tokens (est.)");
    expect(stdout).toMatch(/characters \/ 4/);
  });

  it("accepts a single --budget", async () => {
    const root = noisyProject();
    const { stdout, exitCode } = await runCli(["compare", root, "--budget", "8000"]);

    expect(exitCode ?? 0).toBe(0);
    expect(stdout).toContain("Pack budget 8000");
    expect(stdout).not.toContain("Pack budget 500");
    expect(stdout).not.toContain("Pack unlimited (0)");
  });

  it("exits non-zero with stderr when the path is missing", async () => {
    const missing = path.join(os.tmpdir(), "contextpack-no-such-compare-root");
    const { stdout, stderr, exitCode } = await runCli(["compare", missing]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("error:");
    expect(stderr).toContain("path not found");
    expect(stdout).not.toContain("Naive dump");
  });

  it("exits non-zero when the path is not a directory", async () => {
    const root = tmpProject({ "file.txt": "x" });
    const { stderr, exitCode } = await runCli(["compare", path.join(root, "file.txt")]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("error:");
    expect(stderr).toContain("not a directory");
  });
});
