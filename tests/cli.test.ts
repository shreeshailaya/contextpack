import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";

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
});
