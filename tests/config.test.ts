import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import {
  ConfigError,
  formatUnknownKeysWarning,
  loadProjectConfig,
  mergeConfigWithCli,
} from "../src/pack/config.js";

const temps: string[] = [];
const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-config-"));
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
  process.exitCode = undefined;
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
    process.exitCode = 1;
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalStderr;
    console.error = originalError;
  }

  const exitCode = process.exitCode;
  process.exitCode = prevExit;
  return { stdout, stderr, exitCode };
}

describe("loadProjectConfig", () => {
  it("loads defaults from .contextpack.json", () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({
        budget: 4000,
        format: "json",
        ignore: ["fixtures/**"],
        include: ["vendor/keep.ts"],
        focus: ["auth", "jwt"],
        maxFileBytes: 1024,
        map: false,
        redact: false,
        quiet: true,
      }),
      "a.txt": "hello",
    });

    const loaded = loadProjectConfig(root);
    expect(loaded).not.toBeNull();
    expect(loaded!.sourceLabel).toBe(".contextpack.json");
    expect(loaded!.unknownKeys).toEqual([]);
    expect(loaded!.config).toEqual({
      budget: 4000,
      format: "json",
      ignore: ["fixtures/**"],
      include: ["vendor/keep.ts"],
      focus: ["auth", "jwt"],
      maxFileBytes: 1024,
      map: false,
      redact: false,
      quiet: true,
    });
  });

  it("prefers .contextpack.json over package.json contextpack", () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ budget: 111 }),
      "package.json": JSON.stringify({
        name: "demo",
        contextpack: { budget: 999, format: "plain" },
      }),
    });

    const loaded = loadProjectConfig(root);
    expect(loaded!.sourceLabel).toBe(".contextpack.json");
    expect(loaded!.config.budget).toBe(111);
    expect(loaded!.config.format).toBeUndefined();
  });

  it("prefers .contextpack.json over contextpack.json", () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ format: "json" }),
      "contextpack.json": JSON.stringify({ format: "plain" }),
    });

    const loaded = loadProjectConfig(root);
    expect(loaded!.sourceLabel).toBe(".contextpack.json");
    expect(loaded!.config.format).toBe("json");
  });

  it("falls back to contextpack.json", () => {
    const root = tmpProject({
      "contextpack.json": JSON.stringify({ ignore: "tmp/**" }),
    });

    const loaded = loadProjectConfig(root);
    expect(loaded!.sourceLabel).toBe("contextpack.json");
    expect(loaded!.config.ignore).toEqual(["tmp/**"]);
  });

  it("falls back to package.json contextpack when no dedicated file exists", () => {
    const root = tmpProject({
      "package.json": JSON.stringify({
        name: "demo",
        contextpack: { budget: 2500, focus: "login" },
      }),
    });

    const loaded = loadProjectConfig(root);
    expect(loaded!.sourceLabel).toBe("package.json");
    expect(loaded!.config.budget).toBe(2500);
    expect(loaded!.config.focus).toEqual(["login"]);
  });

  it("walks up from a nested pack root", () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ format: "plain" }),
      "nested/src/a.ts": "export const a = 1;\n",
    });

    const loaded = loadProjectConfig(path.join(root, "nested"));
    expect(loaded!.sourceLabel).toBe(path.join("..", ".contextpack.json"));
    expect(loaded!.config.format).toBe("plain");
  });

  it("skips package.json without a contextpack key", () => {
    const root = tmpProject({
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
      "a.txt": "x",
    });

    expect(loadProjectConfig(root)).toBeNull();
  });

  it("returns null when no config is present", () => {
    const root = tmpProject({ "a.txt": "x" });
    expect(loadProjectConfig(root)).toBeNull();
  });

  it("throws a clear error for invalid JSON, including the file path", () => {
    const root = tmpProject({
      ".contextpack.json": "{ budget: 8000 }",
    });
    const configPath = path.join(root, ".contextpack.json");

    try {
      loadProjectConfig(root);
      expect.unreachable("expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain(configPath);
      expect((err as ConfigError).message).toMatch(/invalid JSON/i);
    }
  });

  it("throws a clear error naming a key with the wrong type", () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ budget: "8000" }),
    });
    const configPath = path.join(root, ".contextpack.json");

    expect(() => loadProjectConfig(root)).toThrow(/invalid config key "budget"/);
    try {
      loadProjectConfig(root);
    } catch (err) {
      expect((err as ConfigError).message).toContain(configPath);
      expect((err as ConfigError).message).toMatch(/number/);
    }
  });

  it("collects unknown and unsupported keys without failing", () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({
        budget: 1000,
        since: "main",
        out: "digest.md",
        list: true,
        pathsFrom: "files.txt",
        extra: true,
      }),
    });

    const loaded = loadProjectConfig(root);
    expect(loaded!.config.budget).toBe(1000);
    expect(loaded!.unknownKeys).toEqual(["since", "out", "list", "pathsFrom", "extra"]);
    expect(formatUnknownKeysWarning(loaded!)).toBe(
      "unknown config keys in .contextpack.json: since, out, list, pathsFrom, extra (ignored)",
    );
  });
});

describe("mergeConfigWithCli", () => {
  const cliDefaults = {
    budget: 16000,
    format: "md" as const,
    ignore: [] as string[],
    include: [] as string[],
    quiet: false,
    redact: true,
    focus: [] as string[],
    map: true,
  };

  it("uses config when the CLI flag was not passed", () => {
    const merged = mergeConfigWithCli(
      {
        config: { budget: 8000, map: false, ignore: ["tests/**"] },
        sourcePath: "/tmp/.contextpack.json",
        sourceLabel: ".contextpack.json",
        unknownKeys: [],
      },
      cliDefaults,
      {},
    );

    expect(merged.budget).toBe(8000);
    expect(merged.map).toBe(false);
    expect(merged.ignore).toEqual(["tests/**"]);
    expect(merged.format).toBe("md");
  });

  it("lets an explicit CLI flag replace the config value", () => {
    const merged = mergeConfigWithCli(
      {
        config: { budget: 8000, ignore: ["tests/**"], focus: ["auth"], map: false },
        sourcePath: "/tmp/.contextpack.json",
        sourceLabel: ".contextpack.json",
        unknownKeys: [],
      },
      { ...cliDefaults, budget: 4000, ignore: ["docs/**"], focus: ["jwt"], map: true },
      { budget: true, ignore: true, focus: true, map: true },
    );

    expect(merged.budget).toBe(4000);
    expect(merged.ignore).toEqual(["docs/**"]);
    expect(merged.focus).toEqual(["jwt"]);
    expect(merged.map).toBe(true);
  });
});

describe("CLI project config", () => {
  it("has --no-config on pack", () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    const opt = packCmd?.options.find((o) => o.long === "--no-config" || o.long === "--config");
    expect(opt).toBeDefined();
  });

  it("applies .contextpack.json defaults and notes the file on stderr", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ format: "json", budget: 0 }),
      "a.txt": "hello",
    });

    const { stdout, stderr, exitCode } = await runCli(["pack", root]);
    expect(exitCode).toBeUndefined();
    const parsed = JSON.parse(stdout) as { files: { path: string }[] };
    expect(parsed.files.some((f) => f.path === "a.txt")).toBe(true);
    expect(stderr).toContain("config: .contextpack.json");
  });

  it("prefers .contextpack.json over package.json in the CLI", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ format: "plain" }),
      "package.json": JSON.stringify({ name: "demo", contextpack: { format: "json" } }),
      "a.txt": "hello",
    });

    const { stdout, stderr } = await runCli(["pack", root, "--budget", "0"]);
    expect(stdout).toContain("===== a.txt");
    expect(stdout).not.toMatch(/^\s*\{/);
    expect(stderr).toContain("config: .contextpack.json");
  });

  it("lets CLI flags override config", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ format: "json", budget: 0 }),
      "a.txt": "hello",
    });

    const { stdout, stderr } = await runCli(["pack", root, "--format", "plain"]);
    expect(stdout).toContain("===== a.txt");
    expect(stdout).toContain("hello");
    expect(stderr).toContain("config: .contextpack.json");
  });

  it("honors config map: false when --no-map was not passed", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ map: false, budget: 0 }),
      "README.md": "# Hello",
    });

    const { stdout, stderr } = await runCli(["pack", root]);
    expect(stdout).toContain("# contextpack digest");
    expect(stdout).not.toContain("## Map");
    expect(stdout).toContain("## README.md");
    expect(stderr).toContain("config: .contextpack.json");
    expect(stderr).not.toMatch(/\bmap ~/);
  });

  it("--no-config skips project config", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ format: "json", budget: 0 }),
      "a.txt": "hello",
    });

    const { stdout, stderr } = await runCli(["pack", root, "--no-config"]);
    expect(stdout).toContain("# contextpack digest");
    expect(stdout).not.toContain('"files"');
    expect(stderr).not.toContain("config:");
  });

  it("exits non-zero on invalid JSON and names the file", async () => {
    const root = tmpProject({
      ".contextpack.json": "{ nope",
      "a.txt": "hello",
    });
    const configPath = path.join(root, ".contextpack.json");

    const { stderr, exitCode } = await runCli(["pack", root]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(configPath);
    expect(stderr).toMatch(/invalid JSON/i);
  });

  it("exits non-zero on a wrong type and names the key", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ quiet: "yes" }),
      "a.txt": "hello",
    });

    const { stderr, exitCode } = await runCli(["pack", root]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('invalid config key "quiet"');
    expect(stderr).toMatch(/boolean/);
  });

  it("warns once about unknown keys and still packs", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({
        budget: 0,
        since: "main",
        out: "nope.md",
        mystery: 1,
      }),
      "a.txt": "hello",
    });

    const { stdout, stderr, exitCode } = await runCli(["pack", root]);
    expect(exitCode).toBeUndefined();
    expect(stdout).toContain("a.txt");
    expect(stderr).toMatch(
      /unknown config keys in \.contextpack\.json: since, out, mystery \(ignored\)/,
    );
    expect(stderr).toContain("config: .contextpack.json");
  });

  it("replaces config ignore when --ignore is passed", async () => {
    const root = tmpProject({
      ".contextpack.json": JSON.stringify({ ignore: ["keep-out.txt"], budget: 0 }),
      "keep-out.txt": "secret",
      "also.txt": "visible",
    });

    const withConfig = await runCli(["pack", root]);
    expect(withConfig.stdout).not.toContain("## keep-out.txt");
    expect(withConfig.stdout).toContain("## also.txt");

    const overridden = await runCli(["pack", root, "--ignore", "also.txt"]);
    expect(overridden.stdout).toContain("## keep-out.txt");
    expect(overridden.stdout).not.toContain("## also.txt");
  });
});
