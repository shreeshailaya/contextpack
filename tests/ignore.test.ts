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

    const result = collectFiles(root);
    if (!result.ok) throw new Error("collectFiles failed");
    const { files } = result.value;
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

    const result = collectFiles(root);
    if (!result.ok) throw new Error("collectFiles failed");
    const paths = result.value.files.map((f) => f.relPath);
    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("secret/key.ts");
    expect(paths).not.toContain("scratch.tmp");
  });

  it("respects root .cursorignore", () => {
    const root = tmpProject({
      ".cursorignore": "agent-secrets/\n*.local.ts\n",
      "app.ts": "export {}",
      "agent-secrets/key.ts": "export const k = 1",
      "scratch.local.ts": "tmp",
    });

    const result = collectFiles(root);
    if (!result.ok) throw new Error("collectFiles failed");
    const paths = result.value.files.map((f) => f.relPath);
    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("agent-secrets/key.ts");
    expect(paths).not.toContain("scratch.local.ts");
  });

  it("respects root .aiignore", () => {
    const root = tmpProject({
      ".aiignore": "private/\n",
      "app.ts": "export {}",
      "private/notes.ts": "export const n = 1",
    });

    const result = collectFiles(root);
    if (!result.ok) throw new Error("collectFiles failed");
    const paths = result.value.files.map((f) => f.relPath);
    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("private/notes.ts");
  });

  it("respects root .copilotignore", () => {
    const root = tmpProject({
      ".copilotignore": "generated/\n",
      "app.ts": "export {}",
      "generated/out.ts": "export const o = 1",
    });

    const result = collectFiles(root);
    if (!result.ok) throw new Error("collectFiles failed");
    const paths = result.value.files.map((f) => f.relPath);
    expect(paths).toContain("app.ts");
    expect(paths).not.toContain("generated/out.ts");
  });

  it("lets --include force-include a path ignored only by .cursorignore", () => {
    const root = tmpProject({
      ".cursorignore": "vendor-agent/lib.ts\n",
      "keep.ts": "a",
      "vendor-agent/lib.ts": "c",
    });

    const ignoredResult = collectFiles(root);
    if (!ignoredResult.ok) throw new Error("collectFiles failed");
    const ignored = ignoredResult.value.files.map((f) => f.relPath);
    expect(ignored).toContain("keep.ts");
    expect(ignored).not.toContain("vendor-agent/lib.ts");

    const forcedResult = collectFiles(root, { include: ["vendor-agent/lib.ts"] });
    if (!forcedResult.ok) throw new Error("collectFiles failed");
    const forced = forcedResult.value.files.map((f) => f.relPath);
    expect(forced).toContain("keep.ts");
    expect(forced).toContain("vendor-agent/lib.ts");
  });

  it("lets --include force-include a path ignored only by .aiignore", () => {
    const root = tmpProject({
      ".aiignore": "hidden.ts\n",
      "keep.ts": "a",
      "hidden.ts": "b",
    });

    const ignoredResult = collectFiles(root);
    if (!ignoredResult.ok) throw new Error("collectFiles failed");
    expect(ignoredResult.value.files.map((f) => f.relPath)).not.toContain("hidden.ts");

    const forcedResult = collectFiles(root, { include: ["hidden.ts"] });
    if (!forcedResult.ok) throw new Error("collectFiles failed");
    expect(forcedResult.value.files.map((f) => f.relPath)).toContain("hidden.ts");
  });

  it("allows extra --ignore and --include overrides", () => {
    const root = tmpProject({
      "keep.ts": "a",
      "drop.ts": "b",
      "vendor/lib.js": "c",
    });

    const ignoredResult = collectFiles(root, { ignore: ["drop.ts"] });
    if (!ignoredResult.ok) throw new Error("collectFiles failed");
    const ignored = ignoredResult.value.files.map((f) => f.relPath);
    expect(ignored).toContain("keep.ts");
    expect(ignored).not.toContain("drop.ts");

    // vendor/ is in DEFAULT_IGNORES — force include a file under it
    const forcedResult = collectFiles(root, { include: ["vendor/lib.js"] });
    if (!forcedResult.ok) throw new Error("collectFiles failed");
    const forced = forcedResult.value.files.map((f) => f.relPath);
    expect(forced).toContain("vendor/lib.js");
  });
});
