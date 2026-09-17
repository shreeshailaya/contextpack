import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { naiveDump } from "../src/pack/naive.js";
import { pack } from "../src/pack/pack.js";
import { estimateTokens } from "../src/pack/tokens.js";

const temps: string[] = [];
const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/demo-project",
);

function tmpProject(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-naive-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("naiveDump", () => {
  it("sums characters/4 per file with no ignore or ranking", () => {
    const a = "abcd"; // 1 token
    const b = "abcde"; // 2 tokens
    const root = tmpProject({
      "a.txt": a,
      "b.txt": b,
    });

    const dump = naiveDump(root);
    expect(dump.fileCount).toBe(2);
    expect(dump.totalTokens).toBe(estimateTokens(a) + estimateTokens(b));
    expect(dump.files.map((f) => f.relPath)).toEqual(["a.txt", "b.txt"]);
  });

  it("includes vendor, lockfiles, and build output that pack() drops", () => {
    const root = tmpProject({
      "README.md": "# hi\n",
      "src/index.js": "console.log(1)\n",
      "package-lock.json": "{}\n",
      "vendor/pad-lib/index.js": "module.exports = 1\n",
      "build/bundle.js": "/* minified */\n",
    });

    const dump = naiveDump(root);
    const naivePaths = dump.files.map((f) => f.relPath);
    expect(naivePaths).toEqual(
      expect.arrayContaining([
        "README.md",
        "src/index.js",
        "package-lock.json",
        "vendor/pad-lib/index.js",
        "build/bundle.js",
      ]),
    );

    const packed = pack(root);
    const packedPaths = packed.files.map((f) => f.path);
    expect(packedPaths).toContain("README.md");
    expect(packedPaths).toContain("src/index.js");
    expect(packedPaths).not.toContain("package-lock.json");
    expect(packedPaths).not.toContain("vendor/pad-lib/index.js");
    expect(packedPaths).not.toContain("build/bundle.js");
  });

  it("does not apply .gitignore", () => {
    const root = tmpProject({
      ".gitignore": "secret.txt\n",
      "keep.ts": "export {}\n",
      "secret.txt": "classified\n",
    });

    const dump = naiveDump(root);
    const paths = dump.files.map((f) => f.relPath);
    expect(paths).toContain("keep.ts");
    expect(paths).toContain("secret.txt");
    expect(paths).toContain(".gitignore");
  });

  it("skips .git/ and NUL binaries", () => {
    const root = tmpProject({
      "ok.ts": "export {}\n",
      ".git/config": "[core]\n",
      "photo.txt": Buffer.from([0x00, 0x01, 0x02, 0xff]),
    });

    const paths = naiveDump(root).files.map((f) => f.relPath);
    expect(paths).toContain("ok.ts");
    expect(paths).not.toContain(".git/config");
    expect(paths).not.toContain("photo.txt");
  });
});

describe("naive dump vs pack on fixtures/demo-project", () => {
  it("naive token estimate is greater than packed under a tight budget", () => {
    const dump = naiveDump(fixture);
    const packed = pack(fixture, { budget: 500 });

    expect(dump.totalTokens).toBeGreaterThan(packed.totalTokens);
    expect(dump.fileCount).toBeGreaterThan(packed.stats.included);
    expect(packed.totalTokens).toBeLessThanOrEqual(500);
  });

  it("unlimited pack still drops fixture noise that naive dump counts", () => {
    const dump = naiveDump(fixture);
    const packed = pack(fixture, { budget: 0 });
    const naivePaths = dump.files.map((f) => f.relPath);
    const packedPaths = packed.files.map((f) => f.path);

    expect(naivePaths).toContain("package-lock.json");
    expect(naivePaths).toContain("vendor/pad-lib/index.js");
    expect(naivePaths).toContain("build/bundle.js");
    expect(packedPaths).not.toContain("package-lock.json");
    expect(packedPaths).not.toContain("vendor/pad-lib/index.js");
    expect(packedPaths).not.toContain("build/bundle.js");
    expect(dump.totalTokens).toBeGreaterThan(packed.totalTokens);
  });
});
