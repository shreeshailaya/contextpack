import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  buildComment,
  errorGuidance,
  formatTokenCount,
  main,
} from "../.github/actions/pack-pr/comment.mjs";

const temps: string[] = [];

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-action-"));
  temps.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

const sampleList = {
  root: "/repo",
  budget: 12000,
  tokenEstimateNote: "approximate: characters / 4",
  entries: [
    { path: "src/cli.ts", tokens: 800, status: "included", kind: "diff" },
    { path: "README.md", tokens: 200, status: "included", kind: "file" },
    { path: "src/new.ts", tokens: 40, status: "partial", kind: "file" },
    { path: "big.ts", tokens: 0, status: "truncated", kind: "file" },
  ],
  summary: {
    included: 2,
    partial: 1,
    truncated: 1,
    skipped: 0,
    totalTokens: 1040,
    discovered: 4,
    ignored: 0,
  },
};

describe("formatTokenCount (action comment helper)", () => {
  it("matches the CLI thresholds", () => {
    expect(formatTokenCount(12)).toBe("12");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(12000)).toBe("12k");
  });
});

describe("buildComment", () => {
  it("starts with the idempotent marker and a summary table", () => {
    const body = buildComment({
      list: sampleList,
      since: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      budget: 12000,
      version: "0.1.10",
    });

    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("### contextpack PR digest");
    expect(body).toContain("| Files included | 3 |");
    expect(body).toContain("| Diffs | 1 |");
    expect(body).toContain("| Approx. tokens | ~1.0k |");
    expect(body).toContain("| Budget | 12000 (9%) |");
    expect(body).toContain("`src/cli.ts` — ~800 tok [diff]");
    expect(body).toContain("`src/new.ts` — ~40 tok [partial]");
    expect(body).toContain("truncated (over budget)");
    expect(body).toContain("`aaaaaaa`");
    expect(body).toContain("Full digest: `contextpack-pr.md` in the `contextpack-pr` workflow artifact.");
    expect(body).toContain("@shree_vitkar/contextpack@0.1.10");
  });

  it("collapses long file lists in a details block", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      path: `f${i}.ts`,
      tokens: 10,
      status: "included" as const,
      kind: "diff" as const,
    }));
    const body = buildComment({
      list: {
        entries,
        summary: { included: 15, partial: 0, truncated: 0, skipped: 0, totalTokens: 150 },
      },
      since: "main",
      budget: 8000,
      topLimit: 3,
    });

    expect(body).toContain("<details>");
    expect(body).toContain("All 15 files");
    expect(body).toContain("`f0.ts`");
    expect(body).toContain("`f14.ts`");
  });

  it("describes an empty pack without failing language", () => {
    const body = buildComment({
      list: { entries: [], summary: { included: 0, partial: 0, truncated: 0, skipped: 0, totalTokens: 0 } },
      since: "origin/master",
      budget: 12000,
      empty: true,
    });

    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("No files to pack");
    expect(body).toContain("fail-on-empty");
    expect(body).not.toContain("| Files included |");
  });

  it("describes a pack error without dumping a fake table", () => {
    const body = buildComment({
      ok: false,
      error: "invalid git ref: nope",
      since: "nope",
      budget: 12000,
    });

    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("could not pack this PR: invalid git ref: nope");
    expect(body).toContain("fail-on-error");
    expect(body).toContain("Typical causes: missing git history");
    expect(body).not.toContain("| Files included |");
  });

  it("does not blame git history when npm install fails", () => {
    const body = buildComment({
      ok: false,
      error:
        "npm install @shree_vitkar/contextpack@0.1.13 failed: npm error notarget No matching version found",
      since: "2c3edf1",
      budget: 12000,
    });

    expect(body).toContain("could not pack this PR: npm install @shree_vitkar/contextpack@0.1.13 failed");
    expect(body).toContain("fail-on-error");
    expect(body).toContain("pinned npm package is missing or failed to install");
    expect(body).not.toContain("missing git history");
    expect(body).not.toContain("Typical causes");
    expect(body).not.toContain("| Files included |");
  });
});

describe("errorGuidance", () => {
  it("keeps the git-history blurb for --since / pack failures", () => {
    expect(errorGuidance("invalid git ref: origin/nope")).toContain("Typical causes: missing git history");
    expect(errorGuidance("contextpack pack failed (exit 1)")).toContain("Typical causes: missing git history");
  });

  it("explains npm/install failures without mentioning git history", () => {
    const g = errorGuidance(
      "npm install @shree_vitkar/contextpack@0.1.13 failed: npm error code ETARGET",
    );
    expect(g.toLowerCase()).not.toContain("git history");
    expect(g).toMatch(/npm package is missing|failed to install/);
  });

  it("explains node/npm missing separately from git", () => {
    const g = errorGuidance("node/npm are not available");
    expect(g.toLowerCase()).not.toContain("git history");
    expect(g).toMatch(/Node\.js and npm/);
  });
});

describe("comment.mjs CLI", () => {
  it("writes a comment file from --list JSON", async () => {
    const listPath = tmpFile("list.json", JSON.stringify(sampleList));
    const outPath = path.join(path.dirname(listPath), "comment.md");

    await main([
      "--list",
      listPath,
      "--out",
      outPath,
      "--since",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "--budget",
      "12000",
    ]);

    const body = fs.readFileSync(outPath, "utf8");
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("| Files included | 3 |");
  });

  it("can be invoked with node as the Action does", () => {
    const listPath = tmpFile("list.json", JSON.stringify(sampleList));
    const outPath = path.join(path.dirname(listPath), "comment.md");
    const script = path.resolve(".github/actions/pack-pr/comment.mjs");

    execFileSync(
      process.execPath,
      [script, "--list", listPath, "--out", outPath, "--since", "HEAD", "--budget", "100"],
      { encoding: "utf8" },
    );

    expect(fs.readFileSync(outPath, "utf8")).toContain(COMMENT_MARKER);
  });
});

describe("Action wiring", () => {
  it("pins the published package version and local composite path", () => {
    const action = fs.readFileSync(".github/actions/pack-pr/action.yml", "utf8");
    const workflow = fs.readFileSync(".github/workflows/contextpack-pr.yml", "utf8");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string };

    const packSh = fs.readFileSync(".github/actions/pack-pr/pack.sh", "utf8");

    expect(action).toContain(`default: "${pkg.version}"`);
    expect(action).toContain("github.action_path }}/pack.sh");
    expect(action).toContain("github.action_path }}/comment.mjs");
    expect(packSh).toContain("npm install --prefix");
    expect(packSh).toContain("@shree_vitkar/contextpack@");
    expect(packSh).toContain("node \"$CLI_JS\" pack");
    expect(packSh).toContain("try_local_cli");
    expect(packSh).toContain("checkout_is_contextpack");
    expect(workflow).toContain("uses: ./.github/actions/pack-pr");
    expect(workflow).toContain(`version: "${pkg.version}"`);
    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("fetch-depth: 0");
  });
});

const FAKE_CLI_JS = `const fs = require("node:fs");
const argv = process.argv.slice(2);
const out = argv[argv.indexOf("--out") + 1];
if (argv.includes("--list")) {
  fs.writeFileSync(
    out,
    JSON.stringify({
      entries: [{ path: "README.md", tokens: 4, status: "included", kind: "diff" }],
      summary: { included: 1, partial: 0, truncated: 0, skipped: 0, totalTokens: 4, discovered: 1, ignored: 0 },
    }),
  );
} else {
  fs.writeFileSync(out, "# packed\\n");
}
`;

function gitRepo(setup: (dir: string) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-packsh-"));
  temps.push(dir);
  execFileSync("git", ["-c", "init.defaultBranch=master", "init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  setup(dir);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "init"], { cwd: dir });
  return dir;
}

function writeFakeCli(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, FAKE_CLI_JS, "utf8");
}

function runPackSh(
  dir: string,
  extraEnv: NodeJS.ProcessEnv = {},
): { stdout: string; outputs: string } {
  const outputFile = path.join(dir, "github_output");
  const tmpDir = path.join(dir, "tmp");
  const runnerTemp = path.join(dir, "runner-temp");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(runnerTemp, { recursive: true });
  const script = path.resolve(".github/actions/pack-pr/pack.sh");
  const stdout = execFileSync("bash", [script], {
    encoding: "utf8",
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpDir,
      GITHUB_OUTPUT: outputFile,
      GITHUB_WORKSPACE: dir,
      CONTEXTPACK_SINCE: "HEAD",
      CONTEXTPACK_VERSION: "0.1.13",
      CONTEXTPACK_OUT: path.join(dir, "out.md"),
      CONTEXTPACK_LIST_OUT: path.join(dir, "list.json"),
      RUNNER_TEMP: runnerTemp,
      CONTEXTPACK_NPM_ATTEMPTS: "1",
      CONTEXTPACK_NPM_RETRY_SLEEP: "0",
      ...extraEnv,
    },
  });
  const outputs = fs.readFileSync(outputFile, "utf8");
  return { stdout, outputs };
}

describe("pack.sh fail-soft", () => {
  it("does not fail the process when no base ref is available", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-packsh-"));
    temps.push(dir);
    const outputFile = path.join(dir, "github_output");
    const script = path.resolve(".github/actions/pack-pr/pack.sh");

    const result = execFileSync("bash", [script], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_OUTPUT: outputFile,
        CONTEXTPACK_SINCE: "",
        PR_BASE_SHA: "",
        PR_BASE_REF: "",
      },
    });

    const outputs = fs.readFileSync(outputFile, "utf8");
    expect(outputs).toContain("ok=false");
    expect(outputs).toContain("empty=true");
    expect(outputs).toMatch(/error=no base ref/);
    expect(result).toContain("No base ref");
  });

  it("uses a local dist/index.js when the checkout is this package", () => {
    const dir = gitRepo((root) => {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "@shree_vitkar/contextpack", version: "0.1.13" }),
      );
      fs.writeFileSync(path.join(root, "README.md"), "hi\n");
      writeFakeCli(path.join(root, "dist", "index.js"));
    });
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "npm"),
      `#!/usr/bin/env bash
echo "npm should not be invoked when local dist exists: $*" >&2
exit 1
`,
      { mode: 0o755 },
    );

    const { stdout, outputs } = runPackSh(dir, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });

    expect(stdout).toContain("Using local contextpack CLI");
    expect(outputs).toContain("ok=true");
    expect(outputs).toMatch(/files=1/);
    expect(fs.existsSync(path.join(dir, "out.md"))).toBe(true);
  });

  it("builds a local CLI when dist is missing on a contextpack checkout", () => {
    const dir = gitRepo((root) => {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "@shree_vitkar/contextpack", version: "0.1.13" }),
      );
      fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
      fs.writeFileSync(path.join(root, "README.md"), "hi\n");
    });
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "npm"),
      `#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == @shree_vitkar/contextpack@* ]]; then
    echo "should not npm install the published package for local build" >&2
    exit 1
  fi
done
if [[ "$1" == "ci" || "$1" == "install" ]]; then
  mkdir -p node_modules
  exit 0
fi
if [[ "$1" == "run" && "$2" == "build" ]]; then
  mkdir -p dist
  cat > dist/index.js << 'EOF'
${FAKE_CLI_JS}
EOF
  exit 0
fi
echo "unexpected npm: $*" >&2
exit 1
`,
      { mode: 0o755 },
    );

    const { stdout, outputs } = runPackSh(dir, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });

    expect(stdout).toContain("building local CLI");
    expect(stdout).toContain("Using local contextpack CLI");
    expect(outputs).toContain("ok=true");
    expect(fs.existsSync(path.join(dir, "dist", "index.js"))).toBe(true);
  });

  it("surfaces npm stderr when install fails in a non-contextpack checkout", () => {
    const dir = gitRepo((root) => {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "other", version: "1.0.0" }));
      fs.writeFileSync(path.join(root, "README.md"), "hi\n");
    });
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "npm"),
      `#!/usr/bin/env bash
if [[ "$1" == "view" ]]; then
  exit 1
fi
echo "npm error code ETARGET" >&2
echo "npm error notarget No matching version found for @shree_vitkar/contextpack@0.1.13." >&2
exit 1
`,
      { mode: 0o755 },
    );

    const { outputs } = runPackSh(dir, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });

    expect(outputs).toContain("ok=false");
    expect(outputs).toContain("npm install @shree_vitkar/contextpack@0.1.13 failed");
    expect(outputs).toMatch(/ETARGET|notarget|No matching version/);
    expect(outputs).not.toMatch(/error=npm install [^=]+ failed$/);
  });

  it("falls back to the latest published version when the pin is missing", () => {
    const dir = gitRepo((root) => {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "other", version: "1.0.0" }));
      fs.writeFileSync(path.join(root, "README.md"), "hi\n");
    });
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "npm"),
      `#!/usr/bin/env bash
prefix=""
spec=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--prefix" ]]; then
    prefix="$arg"
  fi
  if [[ "$arg" == @shree_vitkar/contextpack@* ]]; then
    spec="$arg"
  fi
  prev="$arg"
done
if [[ "$1" == "view" ]]; then
  echo "0.1.12"
  exit 0
fi
if [[ "$spec" == *@0.1.13 ]]; then
  echo "npm error code ETARGET" >&2
  echo "npm error notarget No matching version found for $spec." >&2
  exit 1
fi
if [[ "$spec" == *@0.1.12 && -n "$prefix" ]]; then
  mkdir -p "$prefix/node_modules/@shree_vitkar/contextpack/dist"
  cat > "$prefix/node_modules/@shree_vitkar/contextpack/dist/index.js" << 'EOF'
${FAKE_CLI_JS}
EOF
  exit 0
fi
echo "unexpected npm: $*" >&2
exit 1
`,
      { mode: 0o755 },
    );

    const { stdout, outputs } = runPackSh(dir, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });

    expect(stdout).toContain("Falling back to @shree_vitkar/contextpack@0.1.12");
    expect(outputs).toContain("ok=true");
  });
});
