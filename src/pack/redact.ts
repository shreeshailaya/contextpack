/**
 * Best-effort redaction of obvious secret-looking substrings.
 *
 * This is not a security scanner: high-precision prefixes and assignment
 * forms only, no entropy heuristics, no network. Prefer false negatives
 * over painting ordinary source with `[REDACTED]`.
 */

export const REDACTED = {
  privateKey: "[REDACTED:private-key]",
  githubToken: "[REDACTED:github-token]",
  openaiKey: "[REDACTED:openai-key]",
  awsAccessKey: "[REDACTED:aws-access-key]",
  slackToken: "[REDACTED:slack-token]",
  bearerToken: "[REDACTED:bearer-token]",
  secret: "[REDACTED:secret]",
} as const;

export interface RedactResult {
  content: string;
  count: number;
}

const PEM_BEGIN = /^([+\t -])?-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----\s*$/;
const PEM_END = /^([+\t -])?-----END ([A-Z0-9 ]*PRIVATE KEY)-----\s*$/;

const GITHUB_RE =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const OPENAI_RE = /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g;
const AWS_ACCESS_RE = /\bAKIA[A-Z0-9]{16}\b/g;
const SLACK_RE = /\bxox[bpa]-[A-Za-z0-9-]{16,}/g;
const BEARER_RE = /\b(Bearer)(\s+)([A-Za-z0-9._\-+/=]{20,})/gi;

/**
 * `api_key` / `secret` / `password` / `token` / `authorization` assignments.
 * Optional quotes around the key so JSON (`"api_key": "…"`) matches.
 */
const ASSIGN_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_])(["']?(?:api[_-]?key|secret|password|passwd|token|authorization)["']?)(\s*[=:]\s*)(?:(["'])([^\n]*?)\3|([^\s"',;]+))`,
  "gi",
);

const PLACEHOLDER_WORDS = new Set([
  "changeme",
  "password",
  "secret",
  "yourapikey",
  "yourtoken",
  "placeholder",
  "example",
  "dummy",
  "sample",
  "todo",
  "xxx",
  "xxxx",
  "insertme",
  "inserthere",
  "replaceme",
  "replacethis",
  "notasecret",
  "apikeyhere",
  "tokengoeshere",
]);

const MIN_ASSIGN_VALUE_LEN = 16;

export function redactSecrets(content: string): RedactResult {
  if (!content) return { content, count: 0 };

  let count = 0;
  let out = content;

  const pem = redactPemBlocks(out);
  out = pem.content;
  count += pem.count;

  const github = replaceLiteral(out, GITHUB_RE, REDACTED.githubToken);
  out = github.content;
  count += github.count;

  const openai = replaceLiteral(out, OPENAI_RE, REDACTED.openaiKey);
  out = openai.content;
  count += openai.count;

  const aws = replaceLiteral(out, AWS_ACCESS_RE, REDACTED.awsAccessKey);
  out = aws.content;
  count += aws.count;

  const slack = replaceLiteral(out, SLACK_RE, REDACTED.slackToken);
  out = slack.content;
  count += slack.count;

  const bearer = redactBearer(out);
  out = bearer.content;
  count += bearer.count;

  const assigned = redactAssignments(out);
  out = assigned.content;
  count += assigned.count;

  return { content: out, count };
}

/**
 * Replace the body of PEM / OpenSSH private-key blocks.
 * Keeps BEGIN/END lines (and unified-diff `+`/`-`/context prefixes) so
 * surrounding structure stays intact.
 */
function redactPemBlocks(content: string): RedactResult {
  const lines = content.split("\n");
  const out: string[] = [];
  let count = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const begin = PEM_BEGIN.exec(line);
    if (!begin) {
      out.push(line);
      i += 1;
      continue;
    }

    let endAt = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (PEM_END.test(lines[j]!)) {
        endAt = j;
        break;
      }
    }

    if (endAt === -1) {
      out.push(line);
      i += 1;
      continue;
    }

    const prefix = begin[1] ?? "";
    out.push(line);
    out.push(`${prefix}${REDACTED.privateKey}`);
    out.push(lines[endAt]!);
    count += 1;
    i = endAt + 1;
  }

  return { content: out.join("\n"), count };
}

function redactBearer(content: string): RedactResult {
  let count = 0;
  const copy = new RegExp(BEARER_RE.source, BEARER_RE.flags);
  const next = content.replace(copy, (_match, label: string, space: string) => {
    count += 1;
    return `${label}${space}${REDACTED.bearerToken}`;
  });
  return { content: next, count };
}

function redactAssignments(content: string): RedactResult {
  let count = 0;
  const copy = new RegExp(ASSIGN_RE.source, ASSIGN_RE.flags);
  const next = content.replace(
    copy,
    (
      match,
      key: string,
      sep: string,
      quote: string | undefined,
      quoted: string | undefined,
      unquoted: string | undefined,
    ) => {
      const value = quoted ?? unquoted ?? "";
      if (!shouldRedactAssignmentValue(value, Boolean(quote))) {
        return match;
      }
      count += 1;
      if (quote) {
        return `${key}${sep}${quote}${REDACTED.secret}${quote}`;
      }
      return `${key}${sep}${REDACTED.secret}`;
    },
  );
  return { content: next, count };
}

function shouldRedactAssignmentValue(value: string, quoted: boolean): boolean {
  if (value.length < MIN_ASSIGN_VALUE_LEN) return false;
  if (isAlreadyRedacted(value)) return false;
  if (isPlaceholder(value)) return false;
  if (/^process\.env\b/.test(value) || /^os\.environ\b/.test(value)) return false;
  if (/\(.*\)/.test(value)) return false;
  // Unquoted camelCase / snake identifiers are usually variables, not secrets.
  if (!quoted && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !/\d/.test(value)) {
    return false;
  }
  return true;
}

function isAlreadyRedacted(value: string): boolean {
  return /^\[REDACTED(?::[a-z0-9-]+)?\]$/.test(value.trim());
}

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  if (/^<[^>]+>$/.test(v)) return true;
  if (/^\$\{[^}]+\}$/.test(v)) return true;
  if (/^\{\{[^}]+\}\}$/.test(v)) return true;
  if (/^%[A-Z0-9_]+%$/.test(v)) return true;
  if (/^\$[A-Z_][A-Z0-9_]*$/.test(v)) return true;
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(v)) return true;

  const normalized = v.toLowerCase().replace(/[-_\s]/g, "");
  return PLACEHOLDER_WORDS.has(normalized);
}

function replaceLiteral(content: string, re: RegExp, replacement: string): RedactResult {
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let count = 0;
  const next = content.replace(copy, () => {
    count += 1;
    return replacement;
  });
  return { content: next, count };
}
