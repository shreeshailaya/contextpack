import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pack } from "../src/pack/pack.js";
import { formatPack } from "../src/pack/format.js";

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-pack-"));
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

describe("pack + format", () => {
  it("produces markdown with file sections", () => {
    const root = tmpProject({
      "README.md": "# Demo",
      "src/main.ts": "export function main() {}\n",
    });

    const result = pack(root, { budget: 50_000 });
    const md = formatPack(result, "md");
    expect(md).toContain("# contextpack digest");
    expect(md).toContain("## README.md");
    expect(md).toContain("## src/main.ts");
    expect(md).toContain("characters / 4");
    expect(md).toContain("# Demo");
  });

  it("produces valid JSON format", () => {
    const root = tmpProject({
      "hi.ts": "export {};\n",
    });
    const result = pack(root);
    const raw = formatPack(result, "json");
    const parsed = JSON.parse(raw) as {
      files: { path: string; content: string }[];
      tokenEstimateNote: string;
    };
    expect(parsed.files[0]?.path).toBe("hi.ts");
    expect(parsed.tokenEstimateNote).toMatch(/characters \/ 4/);
  });

  it("produces plain format with separators", () => {
    const root = tmpProject({ "a.txt": "hello" });
    const plain = formatPack(pack(root), "plain");
    expect(plain).toContain("===== a.txt");
    expect(plain).toContain("hello");
  });
});
