import fs from "node:fs";
import path from "node:path";
import {
  AGENTS_FILE_HEADER,
  AGENTS_REL,
  AGENTS_SECTION,
  AGENTS_SECTION_END,
  AGENTS_SECTION_START,
  CURSOR_RULE,
  CURSOR_RULE_REL,
  SKILL,
  SKILL_REL,
} from "./templates.js";

export interface InitOptions {
  force?: boolean;
  agents?: boolean;
  quiet?: boolean;
}

export type InitAction = "created" | "skipped" | "overwritten" | "appended";

export interface InitFileResult {
  relativePath: string;
  action: InitAction;
}

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitError";
  }
}

export interface InitResult {
  root: string;
  files: InitFileResult[];
}

const DEFAULT_FILES: { relativePath: string; content: string }[] = [
  { relativePath: CURSOR_RULE_REL, content: CURSOR_RULE },
  { relativePath: SKILL_REL, content: SKILL },
];

export function runInit(targetPath: string, opts: InitOptions = {}): InitResult {
  const root = resolveInitRoot(targetPath);
  const force = Boolean(opts.force);
  const files: InitFileResult[] = [];

  for (const file of DEFAULT_FILES) {
    files.push(writeDropIn(root, file.relativePath, file.content, force));
  }

  if (opts.agents) {
    files.push(writeAgents(root, force));
  }

  return { root, files };
}

export function formatInitSummary(result: InitResult): string {
  const parts = result.files.map((f) => {
    if (f.action === "skipped") {
      return `skipped ${f.relativePath} (exists)`;
    }
    return `${f.action} ${f.relativePath}`;
  });
  return `contextpack init: ${parts.join(" · ")}`;
}

function resolveInitRoot(targetPath: string): string {
  const root = path.resolve(targetPath);

  if (fs.existsSync(root)) {
    let st: fs.Stats;
    try {
      st = fs.statSync(root);
    } catch (err) {
      throw wrapFsError(`cannot stat ${root}`, err);
    }
    if (!st.isDirectory()) {
      throw new InitError(`not a directory: ${root}`);
    }
    return root;
  }

  try {
    fs.mkdirSync(root, { recursive: true });
  } catch (err) {
    throw wrapFsError(`cannot create directory ${root}`, err);
  }

  return root;
}

function writeDropIn(
  root: string,
  relativePath: string,
  content: string,
  force: boolean,
): InitFileResult {
  const abs = path.join(root, relativePath);
  const exists = pathExists(abs);

  if (exists && !force) {
    return { relativePath, action: "skipped" };
  }

  ensureParentDir(abs, relativePath);
  writeText(abs, content, relativePath);

  return { relativePath, action: exists ? "overwritten" : "created" };
}

function writeAgents(root: string, force: boolean): InitFileResult {
  const abs = path.join(root, AGENTS_REL);
  const exists = pathExists(abs);

  if (!exists) {
    ensureParentDir(abs, AGENTS_REL);
    writeText(abs, AGENTS_FILE_HEADER + AGENTS_SECTION, AGENTS_REL);
    return { relativePath: AGENTS_REL, action: "created" };
  }

  const current = readText(abs, AGENTS_REL);
  if (current.includes(AGENTS_SECTION_START)) {
    if (!force) {
      return { relativePath: AGENTS_REL, action: "skipped" };
    }
    writeText(abs, replaceAgentsSection(current, AGENTS_SECTION), AGENTS_REL);
    return { relativePath: AGENTS_REL, action: "overwritten" };
  }

  writeText(abs, appendSection(current, AGENTS_SECTION), AGENTS_REL);
  return { relativePath: AGENTS_REL, action: "appended" };
}

function replaceAgentsSection(existing: string, section: string): string {
  const start = existing.indexOf(AGENTS_SECTION_START);
  if (start === -1) {
    return appendSection(existing, section);
  }
  const end = existing.indexOf(AGENTS_SECTION_END, start);
  if (end === -1) {
    return existing.slice(0, start) + section;
  }
  const after = existing.slice(end + AGENTS_SECTION_END.length);
  return existing.slice(0, start) + section + after.replace(/^\n/, "");
}

function appendSection(existing: string, section: string): string {
  const base = existing.endsWith("\n") ? existing : `${existing}\n`;
  const gap = base.endsWith("\n\n") ? "" : "\n";
  return `${base}${gap}${section}`;
}

function ensureParentDir(abs: string, relativePath: string): void {
  const parent = path.dirname(abs);
  if (fs.existsSync(parent)) {
    let st: fs.Stats;
    try {
      st = fs.statSync(parent);
    } catch (err) {
      throw wrapFsError(`cannot stat ${relativePath}`, err);
    }
    if (!st.isDirectory()) {
      throw new InitError(
        `cannot write ${relativePath}: ${path.dirname(relativePath)} exists and is not a directory`,
      );
    }
    return;
  }
  try {
    fs.mkdirSync(parent, { recursive: true });
  } catch (err) {
    throw wrapFsError(`cannot create directory for ${relativePath}`, err);
  }
}

function pathExists(abs: string): boolean {
  try {
    fs.accessSync(abs, fs.constants.F_OK);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw wrapFsError(`cannot access ${abs}`, err);
  }
}

function readText(abs: string, relativePath: string): string {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    throw wrapFsError(`cannot read ${relativePath}`, err);
  }
}

function writeText(abs: string, content: string, relativePath: string): void {
  try {
    fs.writeFileSync(abs, content, "utf8");
  } catch (err) {
    throw wrapFsError(`cannot write ${relativePath}`, err);
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

function wrapFsError(prefix: string, err: unknown): InitError {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: string }).code)
      : "";
  const suffix = code ? ` (${code})` : "";
  return new InitError(`${prefix}: ${message}${suffix}`);
}
