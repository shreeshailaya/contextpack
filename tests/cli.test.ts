import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { pack } from "../src/pack/pack.js";
import { formatList } from "../src/pack/format.js";

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-cli-"));
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

describe("CLI", () => {
  it("has version flag", () => {
    const program = createProgram();
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("defaults budget to 16000", () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    expect(packCmd).toBeDefined();

    const budgetOpt = packCmd!.options.find((o) => o.long === "--budget");
    expect(budgetOpt).toBeDefined();
    expect(budgetOpt!.defaultValue).toBe(16000);
  });

  it("accepts budget 0 for unlimited", async () => {
    const root = tmpProject({
      "a.txt": "hello",
      "b.txt": "world",
    });

    const program = createProgram();
    program.exitOverride();

    let stdout = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += chunk.toString();
      return true;
    };

    let stderr = "";
    const originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderr += chunk.toString();
      return true;
    };

    try {
      await program.parseAsync(["node", "contextpack", "pack", root, "--budget", "0"]);
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalStderr;
    }

    expect(stdout).toContain("# contextpack digest");
    expect(stdout).toContain("a.txt");
    expect(stdout).toContain("b.txt");
    expect(stderr).not.toContain("budget");
  });

  it("shows truncation count in stderr", async () => {
    const root = tmpProject({
      "README.md": "# README\n".repeat(100),
      "big.txt": "x".repeat(10000),
    });

    const program = createProgram();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });

    let stderr = "";
    const originalError = console.error;
    console.error = (msg: string) => {
      stderr += msg;
    };

    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (): boolean => true;

    try {
      await program.parseAsync(["node", "contextpack", "pack", root, "--budget", "500"]);
    } finally {
      process.stdout.write = originalWrite;
      console.error = originalError;
    }

    expect(stderr).toContain("truncated");
    expect(stderr).toContain("budget");
  });

  it("has --list flag", () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    expect(packCmd).toBeDefined();

    const listOpt = packCmd!.options.find((o) => o.long === "--list");
    expect(listOpt).toBeDefined();
    expect(listOpt!.short).toBe("-l");
  });

  it("--list outputs plain text preview", async () => {
    const root = tmpProject({
      "README.md": "# Hello",
      "src/main.ts": "export const x = 1;",
    });

    const program = createProgram();
    program.exitOverride();

    let stdout = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += chunk.toString();
      return true;
    };

    const originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (): boolean => true;

    const originalError = console.error;
    console.error = () => {};

    try {
      await program.parseAsync(["node", "contextpack", "pack", root, "--list"]);
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalStderr;
      console.error = originalError;
    }

    expect(stdout).toContain("contextpack --list preview");
    expect(stdout).toContain("PATH");
    expect(stdout).toContain("~TOKENS");
    expect(stdout).toContain("STATUS");
    expect(stdout).toContain("README.md");
    expect(stdout).toContain("src/main.ts");
    expect(stdout).toContain("included");
    expect(stdout).not.toContain("# Hello");
  });

  it("--list with --format json outputs JSON preview", async () => {
    const root = tmpProject({
      "a.txt": "hello",
      "b.txt": "world",
    });

    const program = createProgram();
    program.exitOverride();

    let stdout = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += chunk.toString();
      return true;
    };

    const originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (): boolean => true;

    const originalError = console.error;
    console.error = () => {};

    try {
      await program.parseAsync(["node", "contextpack", "pack", root, "--list", "--format", "json"]);
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalStderr;
      console.error = originalError;
    }

    const parsed = JSON.parse(stdout) as {
      entries: { path: string; status: string }[];
      summary: { included: number };
    };
    expect(parsed.entries).toBeDefined();
    expect(parsed.entries.length).toBe(2);
    expect(parsed.summary.included).toBe(2);
    expect(stdout).not.toContain("hello");
    expect(stdout).not.toContain("world");
  });

  it("--list shows truncated files with budget", async () => {
    const root = tmpProject({
      "README.md": "# README",
      "big.txt": "x".repeat(10000),
    });

    const program = createProgram();
    program.exitOverride();

    let stdout = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += chunk.toString();
      return true;
    };

    const originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (): boolean => true;

    const originalError = console.error;
    console.error = () => {};

    try {
      await program.parseAsync(["node", "contextpack", "pack", root, "--list", "--budget", "100"]);
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalStderr;
      console.error = originalError;
    }

    expect(stdout).toContain("truncated");
    expect(stdout).toContain("big.txt");
  });

  it("has --diff flag", () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    expect(packCmd).toBeDefined();

    const diffOpt = packCmd!.options.find((o) => o.long === "--diff");
    expect(diffOpt).toBeDefined();
    expect(diffOpt!.short).toBeUndefined();
  });

  it("--diff without --since exits with a clear error", async () => {
    const root = tmpProject({
      "a.txt": "hello",
    });

    const program = createProgram();
    program.exitOverride();

    let stderr = "";
    const originalError = console.error;
    console.error = (msg: string) => {
      stderr += String(msg);
    };

    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (): boolean => true;

    const prevExit = process.exitCode;
    process.exitCode = undefined;

    try {
      await program.parseAsync(["node", "contextpack", "pack", root, "--diff"]);
    } finally {
      process.stdout.write = originalWrite;
      console.error = originalError;
    }

    expect(process.exitCode).toBe(1);
    expect(stderr).toContain("--diff requires --since");
    process.exitCode = prevExit;
  });
});

describe("formatList", () => {
  it("produces plain text with file statuses", () => {
    const root = tmpProject({
      "README.md": "# Demo",
      "src/main.ts": "export function main() {}\n",
    });

    const result = pack(root, { budget: 50_000 });
    const plain = formatList(result, "plain");

    expect(plain).toContain("contextpack --list preview");
    expect(plain).toContain("README.md");
    expect(plain).toContain("src/main.ts");
    expect(plain).toContain("included");
    expect(plain).not.toContain("# Demo");
  });

  it("produces JSON without content", () => {
    const root = tmpProject({
      "hello.ts": "export const x = 1;",
    });

    const result = pack(root);
    const raw = formatList(result, "json");
    const parsed = JSON.parse(raw) as {
      entries: { path: string; status: string; tokens: number }[];
      summary: { included: number; totalTokens: number };
    };

    expect(parsed.entries[0]?.path).toBe("hello.ts");
    expect(parsed.entries[0]?.status).toBe("included");
    expect(parsed.summary.included).toBe(1);
    expect(raw).not.toContain("export const");
  });

  it("shows partial and truncated statuses with budget", () => {
    const root = tmpProject({
      "README.md": "# Header\n",
      "big.txt": "x".repeat(8000),
    });

    const result = pack(root, { budget: 100 });
    const raw = formatList(result, "json");
    const parsed = JSON.parse(raw) as {
      entries: { path: string; status: string }[];
      summary: { partial: number; truncated: number };
    };

    const statuses = parsed.entries.map((e) => e.status);
    expect(statuses).toContain("truncated");
  });
});
