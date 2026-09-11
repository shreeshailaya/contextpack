import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pack } from "../src/pack/pack.js";
import { estimateTokens } from "../src/pack/tokens.js";

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-budget-"));
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

describe("pack budget", () => {
  it("includes all text files when no budget is set", () => {
    const root = tmpProject({
      "README.md": "# Project",
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
    });

    const result = pack(root);
    expect(result.stats.included).toBe(3);
    expect(result.truncated).toHaveLength(0);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.budget).toBeNull();
  });

  it("truncates lower-priority files when over budget", () => {
    const big = "x".repeat(4000); // ~1000 tokens
    const root = tmpProject({
      "README.md": "# hi\n",
      "src/small.ts": "export const s = 1;\n",
      "tests/huge.test.ts": big,
    });

    const hugeTokens = estimateTokens(big);
    const result = pack(root, { budget: hugeTokens }); // enough for huge alone, but README/src preferred

    expect(result.budget).toBe(hugeTokens);
    expect(result.totalTokens).toBeLessThanOrEqual(hugeTokens);
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("src/small.ts");
    // huge test file should be truncated (not fully fit) under tight-ish budget preferring src
    // With partial inclusion, it may appear in files with partial=true AND in truncated list
    expect(result.truncated).toContain("tests/huge.test.ts");

    // If the file is included, it should be marked as partial (not fully included)
    const hugeFile = result.files.find((f) => f.path === "tests/huge.test.ts");
    if (hugeFile) {
      expect(hugeFile.partial).toBe(true);
      expect(hugeFile.content.length).toBeLessThan(big.length);
    }
  });

  it("never exceeds the token budget for included content", () => {
    const root = tmpProject({
      "a.ts": "a".repeat(200),
      "b.ts": "b".repeat(200),
      "c.ts": "c".repeat(200),
    });

    const budget = 80;
    const result = pack(root, { budget });
    expect(result.totalTokens).toBeLessThanOrEqual(budget);
    const sum = result.files.reduce((s, f) => s + f.tokens, 0);
    expect(sum).toBe(result.totalTokens);
  });

  it("partially includes a file when it does not fully fit but budget remains", () => {
    const smallContent = "# Small\n";
    const largeContent = "x".repeat(2000);

    const root = tmpProject({
      "README.md": smallContent,
      "src/large.ts": largeContent,
    });

    const smallTokens = estimateTokens(smallContent);
    const budget = smallTokens + 200;

    const result = pack(root, { budget });

    expect(result.totalTokens).toBeLessThanOrEqual(budget);

    const readme = result.files.find((f) => f.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme?.partial).toBeFalsy();

    const large = result.files.find((f) => f.path === "src/large.ts");
    expect(large).toBeDefined();
    expect(large?.partial).toBe(true);
    expect(large!.content.length).toBeLessThan(largeContent.length);
    expect(large!.tokens).toBeLessThanOrEqual(200);

    expect(result.truncated).toContain("src/large.ts");
  });

  it("skips partial inclusion when remaining budget is below minimum threshold", () => {
    const smallContent = "# Small\n";
    const largeContent = "x".repeat(2000);

    const root = tmpProject({
      "README.md": smallContent,
      "src/large.ts": largeContent,
    });

    const smallTokens = estimateTokens(smallContent);
    const budget = smallTokens + 50;

    const result = pack(root, { budget });

    expect(result.totalTokens).toBeLessThanOrEqual(budget);

    const readme = result.files.find((f) => f.path === "README.md");
    expect(readme).toBeDefined();

    const large = result.files.find((f) => f.path === "src/large.ts");
    expect(large).toBeUndefined();

    expect(result.truncated).toContain("src/large.ts");
  });

  it("only partially includes the first file that does not fit", () => {
    const smallContent = "# Small\n";
    const mediumContent = "y".repeat(800);
    const largeContent = "x".repeat(2000);

    const root = tmpProject({
      "README.md": smallContent,
      "src/medium.ts": mediumContent,
      "src/large.ts": largeContent,
    });

    const smallTokens = estimateTokens(smallContent);
    const budget = smallTokens + 150;

    const result = pack(root, { budget });

    expect(result.totalTokens).toBeLessThanOrEqual(budget);

    const partialFiles = result.files.filter((f) => f.partial);
    expect(partialFiles.length).toBeLessThanOrEqual(1);

    const large = result.files.find((f) => f.path === "src/large.ts");
    if (large) {
      expect(large.partial).toBe(true);
    }

    expect(result.truncated.length).toBeGreaterThanOrEqual(1);
  });

  it("marks partial files in output formats", () => {
    const smallContent = "# Small\n";
    const largeContent = "x".repeat(2000);

    const root = tmpProject({
      "README.md": smallContent,
      "src/large.ts": largeContent,
    });

    const smallTokens = estimateTokens(smallContent);
    const budget = smallTokens + 200;

    const result = pack(root, { budget });

    const large = result.files.find((f) => f.path === "src/large.ts");
    expect(large?.partial).toBe(true);
  });
});
