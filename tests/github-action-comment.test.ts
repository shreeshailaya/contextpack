import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  buildComment,
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
    expect(body).not.toContain("| Files included |");
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
    expect(workflow).toContain("uses: ./.github/actions/pack-pr");
    expect(workflow).toContain(`version: "${pkg.version}"`);
    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("fetch-depth: 0");
  });
});

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
});
