import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pack } from "../src/pack/pack.js";
import { formatList, formatPack } from "../src/pack/format.js";
import { collectFiles } from "../src/pack/collect.js";
import { REDACTED, redactSecrets } from "../src/pack/redact.js";

const temps: string[] = [];

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextpack-redact-"));
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

/** Official-looking fakes only. Never a live credential. */
const FAKE = {
  github: "ghp_exampletokenexampletoken",
  githubFine: "github_pat_exampletokenexampletoken",
  openai: "sk-abcdefghijklmnopqrstuvwxyz12example",
  openaiProj: "sk-proj-abcdefghijklmnopqrstuvwx",
  aws: "AKIAIOSFODNN7EXAMPLE",
  slack: "xoxb-exampletokenexampletoken",
  bearer: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signaturevalue",
  assigned: "abcdefghijklmnopqrstuvwxyz12",
  pem: [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEAtotally-fake-not-a-real-key-block-xxxxx",
    "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n"),
};

describe("redactSecrets", () => {
  it("redacts PEM private-key bodies and keeps BEGIN/END", () => {
    const src = `before\n${FAKE.pem}\nafter\n`;
    const result = redactSecrets(src);
    expect(result.count).toBe(1);
    expect(result.content).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(result.content).toContain("-----END RSA PRIVATE KEY-----");
    expect(result.content).toContain(REDACTED.privateKey);
    expect(result.content).not.toContain("totally-fake-not-a-real-key");
  });

  it("redacts PEM bodies inside a unified diff (keeps + prefixes)", () => {
    const diff = [
      "diff --git a/key.pem b/key.pem",
      "--- a/key.pem",
      "+++ b/key.pem",
      "@@ -0,0 +1,4 @@",
      "+-----BEGIN RSA PRIVATE KEY-----",
      "+MIIEowIBAAKCAQEAtotally-fake-not-a-real-key-block-xxxxx",
      "+yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
      "+-----END RSA PRIVATE KEY-----",
    ].join("\n");

    const result = redactSecrets(diff);
    expect(result.count).toBe(1);
    expect(result.content).toContain("+-----BEGIN RSA PRIVATE KEY-----");
    expect(result.content).toContain(`+${REDACTED.privateKey}`);
    expect(result.content).toContain("+-----END RSA PRIVATE KEY-----");
    expect(result.content).not.toContain("totally-fake-not-a-real-key");
  });

  it("redacts GitHub, OpenAI, AWS, Slack, and Bearer tokens", () => {
    const src = [
      `gh: ${FAKE.github}`,
      `fine: ${FAKE.githubFine}`,
      `oa: ${FAKE.openai}`,
      `proj: ${FAKE.openaiProj}`,
      `aws: ${FAKE.aws}`,
      `slack: ${FAKE.slack}`,
      `Authorization: Bearer ${FAKE.bearer}`,
    ].join("\n");

    const result = redactSecrets(src);
    expect(result.count).toBe(7);
    expect(result.content).toContain(REDACTED.githubToken);
    expect(result.content).toContain(REDACTED.openaiKey);
    expect(result.content).toContain(REDACTED.awsAccessKey);
    expect(result.content).toContain(REDACTED.slackToken);
    expect(result.content).toContain(`Bearer ${REDACTED.bearerToken}`);
    expect(result.content).not.toContain(FAKE.github);
    expect(result.content).not.toContain(FAKE.githubFine);
    expect(result.content).not.toContain(FAKE.openai);
    expect(result.content).not.toContain(FAKE.openaiProj);
    expect(result.content).not.toContain(FAKE.aws);
    expect(result.content).not.toContain(FAKE.slack);
    expect(result.content).not.toContain(FAKE.bearer);
  });

  it("redacts assignment forms and keeps quotes / structure", () => {
    const src = [
      `const api_key = "${FAKE.assigned}";`,
      `password: '${FAKE.assigned}'`,
      `token=${FAKE.assigned}`,
      `"secret": "${FAKE.assigned}"`,
    ].join("\n");

    const result = redactSecrets(src);
    expect(result.count).toBe(4);
    expect(result.content).toContain(`api_key = "${REDACTED.secret}"`);
    expect(result.content).toContain(`password: '${REDACTED.secret}'`);
    expect(result.content).toContain(`token=${REDACTED.secret}`);
    expect(result.content).toContain(`"secret": "${REDACTED.secret}"`);
    expect(result.content).not.toContain(FAKE.assigned);
  });

  it("does not redact short placeholders or env references", () => {
    const src = [
      'api_key = "YOUR_API_KEY"',
      "password: changeme",
      "token = process.env.API_KEY",
      "secret: ${API_KEY}",
      'authorization = "<YOUR_TOKEN>"',
      "const token = someOtherVariable;",
      'api_key = "short"',
    ].join("\n");

    const result = redactSecrets(src);
    expect(result.count).toBe(0);
    expect(result.content).toBe(src);
  });

  it("does not redact non-private PEM certificates", () => {
    const src = [
      "-----BEGIN CERTIFICATE-----",
      "MIIFakeCertificateBodyNotASecretxxxxxxx",
      "-----END CERTIFICATE-----",
    ].join("\n");
    const result = redactSecrets(src);
    expect(result.count).toBe(0);
    expect(result.content).toBe(src);
  });

  it("labels a prefixed token rather than the generic assignment when both match", () => {
    const src = `api_key = "${FAKE.github}"`;
    const result = redactSecrets(src);
    expect(result.content).toContain(REDACTED.githubToken);
    expect(result.content).not.toContain(FAKE.github);
    expect(result.count).toBe(1);
  });
});

describe("pack redaction", () => {
  it("redacts secrets in packed file contents by default", () => {
    const root = tmpProject({
      "src/config.ts": `export const token = "${FAKE.github}";\n`,
    });

    const result = pack(root);
    const file = result.files.find((f) => f.path === "src/config.ts");
    expect(file).toBeDefined();
    expect(file!.content).toContain(REDACTED.githubToken);
    expect(file!.content).not.toContain(FAKE.github);
    expect(result.stats.redacted).toBe(1);

    const md = formatPack(result, "md");
    expect(md).toContain("Redacted (best-effort)");
    expect(md).toContain(REDACTED.githubToken);
    expect(md).not.toContain(FAKE.github);

    const parsed = JSON.parse(formatPack(result, "json")) as {
      stats: { redacted: number };
      files: { content: string }[];
    };
    expect(parsed.stats.redacted).toBe(1);
    expect(parsed.files[0]?.content).not.toContain(FAKE.github);
  });

  it("keeps secrets when redact is disabled", () => {
    const root = tmpProject({
      "src/config.ts": `export const token = "${FAKE.github}";\n`,
    });

    const result = pack(root, { redact: false });
    const file = result.files.find((f) => f.path === "src/config.ts");
    expect(file!.content).toContain(FAKE.github);
    expect(file!.content).not.toContain(REDACTED.githubToken);
    expect(result.stats.redacted).toBe(0);
  });

  it("still ignores .env paths (redaction does not replace path ignores)", () => {
    const root = tmpProject({
      ".env": `OPENAI_KEY=${FAKE.openai}\n`,
      ".env.local": `SECRET=${FAKE.assigned}\n`,
      "src/app.ts": `export const ok = true;\n`,
    });

    const collected = collectFiles(root);
    if (!collected.ok) throw new Error("collectFiles failed");
    const paths = collected.value.files.map((f) => f.relPath);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain(".env.local");

    const result = pack(root);
    expect(result.files.map((f) => f.path)).not.toContain(".env");
    expect(result.files.every((f) => !f.content.includes(FAKE.openai))).toBe(true);
    expect(formatPack(result, "md")).not.toContain(FAKE.openai);
  });

  it("does not leak secret bodies through --list", () => {
    const root = tmpProject({
      "src/config.ts": `export const token = "${FAKE.github}";\n`,
    });

    const result = pack(root);
    const plain = formatList(result, "plain");
    const json = formatList(result, "json");
    expect(plain).not.toContain(FAKE.github);
    expect(json).not.toContain(FAKE.github);
    const parsed = JSON.parse(json) as { summary: { redacted: number } };
    expect(parsed.summary.redacted).toBe(1);
  });
});
