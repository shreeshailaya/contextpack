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
    // huge test file should often be truncated under tight-ish budget preferring src
    // With budget == hugeTokens, README+src may fit and leave huge out, or huge alone if selected first.
    // Priority puts README/src before tests, so huge should be truncated.
    expect(result.truncated).toContain("tests/huge.test.ts");
    expect(paths).not.toContain("tests/huge.test.ts");
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
});
