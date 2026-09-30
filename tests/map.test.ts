import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pack } from "../src/pack/pack.js";
import { formatList, formatPack } from "../src/pack/format.js";
import { estimateMapTokens } from "../src/pack/map.js";
import { createProgram } from "../src/cli.js";

const temps: string[] = [];
const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-map-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

beforeEach(() => {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    enumerable: true,
    value: true,
  });
});

afterEach(() => {
  if (stdinTtyDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
  } else {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function runCli(
  argv: string[],
): Promise<{ stdout: string; stderr: string }> {
  const program = createProgram();
  program.exitOverride();

  let stdout = "";
  let stderr = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalError = console.error;

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
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalStderr;
    console.error = originalError;
  }

  return { stdout, stderr };
}

describe("digest map", () => {
  it("includes a Map section in markdown with included vs truncated", () => {
    const root = tmpProject({
      "README.md": "# Header\n",
      "big.txt": "x".repeat(8000),
    });

    const result = pack(root, { budget: 80 });
    const md = formatPack(result, "md");

    expect(md).toContain("## Map");
    expect(md).toContain("Status matches `--list`");
    expect(md).toContain("chars÷4");
    expect(md).toMatch(/`README\.md` included/);
    expect(md).toMatch(/`big\.txt` truncated/);
    expect(result.stats.mapTokens).toBeGreaterThan(0);
    expect(result.stats.mapTokens).toBe(estimateMapTokens(result.map));
    expect(result.totalTokens + result.stats.mapTokens).toBeLessThanOrEqual(80);
    expect(result.totalTokens).toBe(result.files.reduce((s, f) => s + f.tokens, 0));
  });

  it("exposes the same inventory on JSON", () => {
    const root = tmpProject({
      "a.txt": "hello",
      "b.txt": "world".repeat(2000),
    });

    const result = pack(root, { budget: 80 });
    const parsed = JSON.parse(formatPack(result, "json")) as {
      map: { path: string; status: string; tokens: number }[];
      mapTokens: number;
      stats: { mapTokens: number };
      tokenEstimateNote: string;
    };

    expect(parsed.tokenEstimateNote).toMatch(/characters \/ 4/);
    expect(parsed.mapTokens).toBe(result.stats.mapTokens);
    expect(parsed.stats.mapTokens).toBe(result.stats.mapTokens);
    const byPath = Object.fromEntries(parsed.map.map((e) => [e.path, e]));
    expect(byPath["a.txt"]?.status).toBe("included");
    expect(byPath["b.txt"]?.status).toBe("truncated");
    expect(byPath["b.txt"]?.tokens).toBeGreaterThan(0);
  });

  it("includes a compact map in plain output", () => {
    const root = tmpProject({ "note.txt": "hi" });
    const plain = formatPack(pack(root, { budget: 500 }), "plain");
    expect(plain).toContain("===== map =====");
    expect(plain).toContain("note.txt");
    expect(plain).toContain("included");
  });

  it("--no-map omits the map and uses the full budget for bodies", () => {
    const root = tmpProject({
      "README.md": "# Header\n",
      "src/keep.ts": "export const keep = 1;\n",
      "tests/huge.test.ts": "x".repeat(4000),
    });

    const withMap = pack(root, { budget: 200 });
    const noMap = pack(root, { budget: 200, map: false });

    expect(withMap.stats.mapTokens).toBeGreaterThan(0);
    expect(noMap.stats.mapTokens).toBe(0);
    expect(formatPack(noMap, "md")).not.toContain("## Map");
    const json = JSON.parse(formatPack(noMap, "json")) as { map?: unknown };
    expect(json.map).toBeUndefined();

    // Same files discovered; without a reserve, at least as many body tokens fit.
    expect(noMap.totalTokens).toBeGreaterThanOrEqual(withMap.totalTokens);
  });

  it("--list matches digest map statuses and does not dump bodies", () => {
    const root = tmpProject({
      "README.md": "# Visible body",
      "big.txt": "SECRET_BODY".repeat(500),
    });

    const result = pack(root, { budget: 80 });
    const list = JSON.parse(formatList(result, "json")) as {
      entries: { path: string; status: string; tokens: number }[];
    };

    const mapByPath = Object.fromEntries(result.map.map((e) => [e.path, e]));
    expect(list.entries).toHaveLength(result.map.length);
    for (const entry of list.entries) {
      expect(entry.status).toBe(mapByPath[entry.path]?.status);
      expect(entry.tokens).toBe(mapByPath[entry.path]?.tokens);
    }

    const raw = formatList(result, "plain");
    expect(raw).toContain("truncated");
    expect(raw).toContain("big.txt");
    expect(raw).not.toContain("SECRET_BODY");
    expect(raw).not.toContain("# Visible body");
    expect(raw).toContain("statuses match the digest map");
  });

  it("sorts the map by path", () => {
    const root = tmpProject({
      "z.txt": "z",
      "a.txt": "a",
      "m.txt": "m",
    });
    const result = pack(root, { budget: 0 });
    expect(result.map.map((e) => e.path)).toEqual(["a.txt", "m.txt", "z.txt"]);
  });

  it("unlimited budget still includes a map and every readable file", () => {
    const root = tmpProject({
      "one.ts": "export const one = 1;\n",
      "two.ts": "export const two = 2;\n",
    });
    const result = pack(root, { budget: null });
    expect(result.stats.included).toBe(2);
    expect(result.truncated).toHaveLength(0);
    expect(result.map.every((e) => e.status === "included")).toBe(true);
    expect(result.stats.mapTokens).toBeGreaterThan(0);
    expect(formatPack(result, "md")).toContain("## Map");
  });
});

describe("CLI map", () => {
  it("has --no-map flag", () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    const opt = packCmd!.options.find((o) => o.long === "--no-map" || o.long === "--map");
    expect(opt).toBeDefined();
  });

  it("prints a Map on default pack and omits it with --no-map", async () => {
    const root = tmpProject({
      "README.md": "# Hello",
      "src/main.ts": "export const x = 1;",
    });

    const on = await runCli(["pack", root, "--budget", "0"]);
    expect(on.stdout).toContain("## Map");
    expect(on.stdout).toContain("`README.md` included");
    expect(on.stderr).toContain("map");

    const off = await runCli(["pack", root, "--budget", "0", "--no-map"]);
    expect(off.stdout).toContain("# contextpack digest");
    expect(off.stdout).not.toContain("## Map");
    expect(off.stdout).toContain("## README.md");
  });

  it("--list stays a preview (no bodies) and agrees with a real pack", async () => {
    const root = tmpProject({
      "README.md": "# Hello from the file body",
      "pad.txt": "y".repeat(4000),
    });

    const list = await runCli(["pack", root, "--list", "--budget", "100", "--format", "json"]);
    const preview = JSON.parse(list.stdout) as {
      entries: { path: string; status: string }[];
    };
    expect(list.stdout).not.toContain("# Hello from the file body");
    expect(preview.entries.some((e) => e.status === "truncated")).toBe(true);

    const digest = await runCli(["pack", root, "--budget", "100", "--format", "json"]);
    const packed = JSON.parse(digest.stdout) as {
      map: { path: string; status: string }[];
    };
    const listStatus = Object.fromEntries(preview.entries.map((e) => [e.path, e.status]));
    const mapStatus = Object.fromEntries(packed.map.map((e) => [e.path, e.status]));
    expect(listStatus).toEqual(mapStatus);
  });
});
