import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pack } from "../src/pack/pack.js";
import { parseFocusTerms, matchesFocus } from "../src/pack/focus.js";
import { estimateTokens } from "../src/pack/tokens.js";
import { createProgram } from "../src/cli.js";
import { formatPack } from "../src/pack/format.js";

const temps: string[] = [];
const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-focus-"));
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
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalStderr;
    console.error = originalError;
  }

  const exitCode = process.exitCode;
  process.exitCode = prevExit;
  return { stdout, stderr, exitCode };
}

describe("parseFocusTerms", () => {
  it("splits on commas then whitespace and drops empties", () => {
    expect(parseFocusTerms("auth,jwt")).toEqual(["auth", "jwt"]);
    expect(parseFocusTerms("login session")).toEqual(["login", "session"]);
    expect(parseFocusTerms("auth, jwt, session token")).toEqual(["auth", "jwt", "session", "token"]);
    expect(parseFocusTerms("  ,  ")).toEqual([]);
    expect(parseFocusTerms("")).toEqual([]);
    expect(parseFocusTerms(undefined)).toEqual([]);
  });

  it("concatenates repeated flags and dedupes case-insensitively", () => {
    expect(parseFocusTerms(["auth,jwt", "login"])).toEqual(["auth", "jwt", "login"]);
    expect(parseFocusTerms(["Auth", "auth", "AUTH"])).toEqual(["Auth"]);
  });
});

describe("matchesFocus", () => {
  it("matches case-insensitively on path or content", () => {
    expect(matchesFocus("src/Auth.ts", "export {}", ["auth"])).toBe(true);
    expect(matchesFocus("src/other.ts", "const JWT = 1;", ["jwt"])).toBe(true);
    expect(matchesFocus("src/other.ts", "hello", ["jwt"])).toBe(false);
  });

  it("is path-only when content is missing", () => {
    expect(matchesFocus("src/auth.ts", undefined, ["auth"])).toBe(true);
    expect(matchesFocus("src/other.ts", undefined, ["auth"])).toBe(false);
  });
});

describe("pack --focus ranking", () => {
  it("boosts a matching file under a tight budget (path match)", () => {
    const auth = "export function authenticate() { return true; }\n".repeat(20);
    const other = "z".repeat(Math.max(auth.length - 80, 40));
    const root = tmpProject({
      "src/auth.ts": auth,
      "src/other.ts": other,
    });

    const authTokens = estimateTokens(auth);
    const otherTokens = estimateTokens(other);
    expect(otherTokens).toBeLessThan(authTokens);
    const budget = authTokens + 10;
    expect(budget).toBeLessThan(authTokens + otherTokens);
    expect(budget - otherTokens).toBeLessThan(100);

    const focused = pack(root, { budget, focus: ["auth"] });
    const authFile = focused.files.find((f) => f.path === "src/auth.ts");
    expect(authFile).toBeDefined();
    expect(authFile?.partial).toBeFalsy();
    expect(focused.truncated).toContain("src/other.ts");
    expect(focused.stats.focused).toBe(1);
    expect(focused.focus).toEqual(["auth"]);

    const baseline = pack(root, { budget });
    const baselineFull = baseline.files.filter((f) => !f.partial).map((f) => f.path);
    expect(baselineFull).toContain("src/other.ts");
    expect(baselineFull).not.toContain("src/auth.ts");
    expect(baseline.focus).toBeUndefined();
    expect(baseline.stats.focused).toBe(0);
  });

  it("does not filter: a non-matching file still packs when budget remains", () => {
    const root = tmpProject({
      "src/auth.ts": "export const auth = 1;\n",
      "src/other.ts": "export const other = 2;\n",
    });

    const result = pack(root, { budget: 50_000, focus: ["auth"] });
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("src/auth.ts");
    expect(paths).toContain("src/other.ts");
    expect(result.truncated).toHaveLength(0);
    expect(result.stats.focused).toBe(1);
  });

  it("treats empty focus as a no-op", () => {
    const big = "x".repeat(800);
    const small = "y".repeat(40);
    const root = tmpProject({
      "src/auth.ts": big,
      "src/other.ts": small,
    });

    const budget = estimateTokens(small) + 20;
    const none = pack(root, { budget });
    const empty = pack(root, { budget, focus: [] });
    const whitespace = pack(root, { budget, focus: ["  ", ","] });

    expect(empty.files.map((f) => f.path)).toEqual(none.files.map((f) => f.path));
    expect(whitespace.files.map((f) => f.path)).toEqual(none.files.map((f) => f.path));
    expect(empty.focus).toBeUndefined();
    expect(whitespace.focus).toBeUndefined();
  });

  it("matches a term in file content, not just the path", () => {
    const withJwt = "export function issue() { return 'signed-jwt-token'; }\n".repeat(15);
    const without = "z".repeat(Math.max(withJwt.length - 80, 40));
    const root = tmpProject({
      "src/tokens.ts": withJwt,
      "src/other.ts": without,
    });

    const jwtTokens = estimateTokens(withJwt);
    const otherTokens = estimateTokens(without);
    expect(otherTokens).toBeLessThan(jwtTokens);
    const budget = jwtTokens + 10;
    expect(budget - otherTokens).toBeLessThan(100);

    const result = pack(root, { budget, focus: ["jwt"] });
    const tokensFile = result.files.find((f) => f.path === "src/tokens.ts");
    expect(tokensFile).toBeDefined();
    expect(tokensFile?.partial).toBeFalsy();
    expect(result.truncated).toContain("src/other.ts");
    expect(result.stats.focused).toBe(1);
  });

  it("lets a focused lower-tier file beat a non-focused higher-tier peer", () => {
    const testFile = "import { auth } from '../src/auth';\n".repeat(8);
    const srcFile = "export const unrelated = 1;\n".repeat(40);
    const root = tmpProject({
      "tests/auth.test.ts": testFile,
      "src/unrelated.ts": srcFile,
    });

    const testTokens = estimateTokens(testFile);
    const srcTokens = estimateTokens(srcFile);
    expect(testTokens).toBeLessThan(srcTokens);
    const budget = Math.max(testTokens + 10, 120);
    expect(budget - testTokens).toBeLessThan(100);
    expect(budget).toBeGreaterThanOrEqual(100);

    const focused = pack(root, { budget, focus: ["auth"] });
    expect(focused.files.map((f) => f.path)).toContain("tests/auth.test.ts");
    expect(focused.truncated).toContain("src/unrelated.ts");

    const baseline = pack(root, { budget });
    expect(baseline.files.map((f) => f.path)).toContain("src/unrelated.ts");
  });

  it("keeps existing tiers among focused files (README before tests)", () => {
    const readme = "# Auth setup\n".repeat(30);
    const testFile = "test('auth', () => {});\n".repeat(30);
    const root = tmpProject({
      "README.md": readme,
      "tests/auth.test.ts": testFile,
    });

    const budget = estimateTokens(readme) + 10;
    expect(budget).toBeLessThan(estimateTokens(readme) + estimateTokens(testFile));

    const result = pack(root, { budget, focus: ["auth"] });
    const readmeFile = result.files.find((f) => f.path === "README.md");
    expect(readmeFile).toBeDefined();
    expect(readmeFile?.partial).toBeFalsy();
    expect(result.truncated).toContain("tests/auth.test.ts");
    expect(result.stats.focused).toBe(2);
  });
});

describe("CLI --focus", () => {
  it("registers --focus on pack", () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    const opt = packCmd?.options.find((o) => o.long === "--focus");
    expect(opt).toBeDefined();
  });

  it("help describes substring ranking, not semantic search", async () => {
    const program = createProgram();
    const packCmd = program.commands.find((c) => c.name() === "pack");
    const help = packCmd?.helpInformation() ?? "";
    expect(help).toContain("--focus");
    expect(help.toLowerCase()).toContain("substring");
    expect(help.toLowerCase()).toContain("not semantic search");
  });

  it("mentions focus on stderr and includes the matching file under --list", async () => {
    const auth = "export function authenticate() { return true; }\n".repeat(20);
    const other = "z".repeat(Math.max(auth.length - 80, 40));
    const root = tmpProject({
      "src/auth.ts": auth,
      "src/other.ts": other,
    });

    const budget = String(estimateTokens(auth) + 10);
    const { stdout, stderr, exitCode } = await runCli([
      "pack",
      root,
      "--focus",
      "auth,jwt",
      "--budget",
      budget,
      "--list",
    ]);

    expect(exitCode).toBeUndefined();
    expect(stdout).toContain("src/auth.ts");
    expect(stdout).toMatch(/src\/auth\.ts\s+\S+\s+included/);
    expect(stdout).toContain("src/other.ts");
    expect(stdout).toMatch(/src\/other\.ts\s+\S+\s+truncated/);
    expect(stderr).toContain("focus: auth,jwt");
    expect(stderr).toMatch(/1 matched/);
  });

  it("accepts repeated --focus flags", async () => {
    const root = tmpProject({
      "src/login.ts": "export const login = true;\n",
      "src/other.ts": "export const n = 1;\n",
    });

    const { stderr, exitCode } = await runCli([
      "pack",
      root,
      "--focus",
      "login",
      "--focus",
      "session",
      "--budget",
      "0",
    ]);

    expect(exitCode).toBeUndefined();
    expect(stderr).toContain("focus: login,session");
  });

  it("empty --focus is a no-op on stderr", async () => {
    const root = tmpProject({
      "src/a.ts": "export const a = 1;\n",
    });

    const { stderr, exitCode } = await runCli(["pack", root, "--focus", "  ,  ", "--budget", "0"]);
    expect(exitCode).toBeUndefined();
    expect(stderr).not.toContain("focus:");
  });

  it("puts focus terms on JSON output", async () => {
    const root = tmpProject({
      "src/auth.ts": "export const auth = 1;\n",
    });
    const result = pack(root, { budget: 8000, focus: ["auth"] });
    const json = JSON.parse(formatPack(result, "json")) as {
      focus: string[];
      stats: { focused: number };
    };
    expect(json.focus).toEqual(["auth"]);
    expect(json.stats.focused).toBe(1);
  });
});

describe("pack --focus with --diff", () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }

  function initGitRepo(dir: string): void {
    git(dir, "init");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "user.name", "Test User");
  }

  it("matches a term in unified diff text", () => {
    const dir = tmpProject({
      "src/app.ts": "const x = 1;\n",
      "src/other.ts": "export const n = 1;\n",
    });
    initGitRepo(dir);
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");

    const focusedBody = "const sessiontokenxyz = 1;\n".repeat(40);
    fs.writeFileSync(path.join(dir, "src/app.ts"), focusedBody, "utf8");
    fs.writeFileSync(path.join(dir, "src/other.ts"), "export const n = 2;\n", "utf8");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "changes");

    const unlimited = pack(dir, { since: "HEAD~1", diff: true, budget: 0, focus: ["sessiontokenxyz"] });
    expect(unlimited.ok).toBe(true);
    if (!unlimited.ok) return;
    const appDiff = unlimited.value.files.find((f) => f.path === "src/app.ts");
    const otherDiff = unlimited.value.files.find((f) => f.path === "src/other.ts");
    expect(appDiff?.kind).toBe("diff");
    expect(appDiff?.content).toContain("sessiontokenxyz");
    expect(otherDiff?.content ?? "").not.toContain("sessiontokenxyz");

    const budget = (appDiff?.tokens ?? 200) + 10;
    const result = pack(dir, {
      since: "HEAD~1",
      diff: true,
      budget,
      focus: ["sessiontokenxyz"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const paths = result.value.files.map((f) => f.path);
    expect(paths).toContain("src/app.ts");
    const app = result.value.files.find((f) => f.path === "src/app.ts");
    expect(app?.kind).toBe("diff");
    expect(app?.partial).toBeFalsy();
    expect(result.value.truncated).toContain("src/other.ts");
    expect(result.value.stats.focused).toBe(1);
  });
});
