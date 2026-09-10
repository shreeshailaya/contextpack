import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectFiles } from "../src/pack/collect.js";

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-ignore-"));
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

describe("collectFiles ignores", () => {
  it("skips node_modules, dist, lockfiles, and .git by default", () => {
    const root = tmpProject({
      "README.md": "# hi",
      "src/index.ts": " console.log(1)",
      "package-lock.json": "{}",
      "node_modules/foo/index.js": "module.exports=1",
      "dist/bundle.js": "/* built */",
      ".git/config": "[core]",
      "yarn.lock": "# lock",
    });

    // Also create a real-ish binary-looking file
    fs.writeFileSync(path.join(root, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));

    const { files } = collectFiles(root);
    const paths = files.map((f) => f.relPath);

    expect(paths).toContain("README.md");
    expect(paths).toContain("src/index.ts");
    expect(paths).not.toContain("package-lock.json");
    expect(paths).not.toContain("yarn.lock");
    expect(paths).not.toContain("node_modules/foo/index.js");
    expect(paths).not.toContain("dist/bundle.js");
    expect(paths).not.toContain(".git/config");
    expect(paths).not.toContain("photo.png");
  });

  it("respects project .gitignore", () => {
    const root = tmpProject({
      ".gitignore": "secret/\n*.tmp\n",
      "app.ts": "export {}",
      "secret/key.ts": "export const k = 1",
      "scratch.tmp": "tmp",
    });

    const paths = collectFiles(root).files.map((f) => f.relPath);
    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("secret/key.ts");
    expect(paths).not.toContain("scratch.tmp");
  });

  it("allows extra --ignore and --include overrides", () => {
    const root = tmpProject({
      "keep.ts": "a",
      "drop.ts": "b",
      "vendor/lib.js": "c",
    });

    const ignored = collectFiles(root, { ignore: ["drop.ts"] }).files.map((f) => f.relPath);
    expect(ignored).toContain("keep.ts");
    expect(ignored).not.toContain("drop.ts");

    // vendor/ is in DEFAULT_IGNORES — force include a file under it
    const forced = collectFiles(root, { include: ["vendor/lib.js"] }).files.map((f) => f.relPath);
    expect(forced).toContain("vendor/lib.js");
  });
});
