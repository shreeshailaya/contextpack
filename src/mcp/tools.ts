import fs from "node:fs";
import path from "node:path";
import { pack } from "../pack/pack.js";
import { formatList, formatPack } from "../pack/format.js";
import { parseFocusTerms } from "../pack/focus.js";
import {
  ConfigError,
  loadProjectConfig,
  mergeConfigWithCli,
  type LoadedConfig,
} from "../pack/config.js";
import {
  looksAbsolute,
  resolveListedPath,
  skipNote,
  staysWithinRoot,
} from "../pack/pathsFrom.js";
import type { ListFormat, OutputFormat, PackResult } from "../types.js";

/** Same default as `contextpack pack` (CLI). */
export const DEFAULT_BUDGET = 16000;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const PATH_PROP = {
  type: "string",
  description:
    'Directory to pack, relative to the server cwd (default: "."). Absolute paths and .. escapes outside cwd are rejected.',
};

const ROOT_PROP = {
  type: "string",
  description: "Alias for path.",
};

const BUDGET_PROP = {
  type: "number",
  description: `Max approximate tokens (characters/4). Default ${DEFAULT_BUDGET}. 0 = unlimited.`,
};

const FOCUS_PROP = {
  anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  description:
    "Boost ranking for files matching keywords (comma/space-separated substring on path or content; not a filter, not semantic search).",
};

const SINCE_PROP = {
  type: "string",
  description: "Only include files changed since this git ref (e.g. main, HEAD~1).",
};

const DIFF_PROP = {
  type: "boolean",
  description: "Pack unified diffs of tracked changes since `since` (requires since).",
};

const PATHS_PROP = {
  type: "array",
  items: { type: "string" },
  description:
    "Pack only these paths (relative to the pack root; no tree walk). Absolute paths and .. escapes are rejected.",
};

const IGNORE_PROP = {
  anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  description: "Extra ignore patterns (gitignore syntax). Replaces project-config ignore when set.",
};

const INCLUDE_PROP = {
  anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  description: "Force-include patterns (overrides ignores).",
};

const NO_MAP_PROP = {
  type: "boolean",
  description: "Omit the digest map and do not reserve map tokens from the budget.",
};

const SHARED_PROPERTIES = {
  path: PATH_PROP,
  root: ROOT_PROP,
  budget: BUDGET_PROP,
  focus: FOCUS_PROP,
  since: SINCE_PROP,
  diff: DIFF_PROP,
  paths: PATHS_PROP,
  ignore: IGNORE_PROP,
  include: INCLUDE_PROP,
  noMap: NO_MAP_PROP,
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "pack",
    description:
      "Pack a directory into a token-budgeted digest (markdown or JSON). Default root is the server cwd. Token counts are estimates (chars/4). Secret redaction is on. Respects .contextpack.json / contextpack.json / package.json contextpack key. Absolute paths and .. escapes outside cwd are rejected.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...SHARED_PROPERTIES,
        format: {
          type: "string",
          enum: ["md", "json"],
          description: "Digest format. Default md.",
        },
      },
    },
  },
  {
    name: "list",
    description:
      "Preview which files would be packed under a budget (same inventory as the digest map; no file bodies). Use this to plan a budget before calling pack. Token counts are estimates (chars/4). Same path, ignore, focus, since, and config rules as pack.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...SHARED_PROPERTIES,
        format: {
          type: "string",
          enum: ["json", "plain"],
          description: "Preview format. Default json.",
        },
      },
    },
  },
];

export interface ToolCallResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface ParsedToolArgs {
  path?: string;
  budget?: number;
  focus?: string[];
  since?: string;
  diff?: boolean;
  paths?: string[];
  ignore?: string[];
  include?: string[];
  format?: string;
  noMap?: boolean;
  fromUser: {
    budget: boolean;
    format: boolean;
    ignore: boolean;
    include: boolean;
    focus: boolean;
    map: boolean;
  };
}

export function resolveToolRoot(
  cwd: string,
  requested: string | undefined,
): { ok: true; root: string } | { ok: false; error: string } {
  const absCwd = path.resolve(cwd);
  const trimmed = (requested ?? ".").trim() || ".";

  if (looksAbsolute(trimmed)) {
    return { ok: false, error: `rejecting absolute path: ${trimmed}` };
  }

  const absPath = path.resolve(absCwd, trimmed);
  if (!staysWithinRoot(absCwd, absPath)) {
    return { ok: false, error: `rejecting path outside server cwd: ${trimmed}` };
  }

  if (!fs.existsSync(absPath)) {
    return { ok: false, error: `path not found: ${trimmed}` };
  }

  let st: fs.Stats;
  try {
    st = fs.statSync(absPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `cannot stat ${trimmed}: ${message}` };
  }

  if (!st.isDirectory()) {
    return { ok: false, error: `not a directory: ${trimmed}` };
  }

  return { ok: true, root: absPath };
}

function asStringList(value: unknown, name: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.slice();
  }
  throw new ToolArgError(`invalid ${name}: expected string or string[]`);
}

class ToolArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgError";
  }
}

function parseToolArgs(raw: unknown): ParsedToolArgs {
  if (raw == null) {
    return {
      fromUser: {
        budget: false,
        format: false,
        ignore: false,
        include: false,
        focus: false,
        map: false,
      },
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolArgError("arguments must be an object");
  }

  const rec = raw as Record<string, unknown>;
  const out: ParsedToolArgs = {
    fromUser: {
      budget: false,
      format: false,
      ignore: false,
      include: false,
      focus: false,
      map: false,
    },
  };

  const pathVal = rec.path ?? rec.root;
  if (pathVal !== undefined) {
    if (typeof pathVal !== "string") {
      throw new ToolArgError("invalid path: expected string");
    }
    out.path = pathVal;
  }

  if (rec.budget !== undefined) {
    if (typeof rec.budget !== "number" || !Number.isFinite(rec.budget) || rec.budget < 0) {
      throw new ToolArgError("invalid budget: expected a non-negative number");
    }
    out.budget = Math.floor(rec.budget);
    out.fromUser.budget = true;
  }

  if (rec.focus !== undefined) {
    out.focus = parseFocusTerms(asStringList(rec.focus, "focus"));
    out.fromUser.focus = true;
  }

  if (rec.since !== undefined) {
    if (typeof rec.since !== "string" || rec.since.trim() === "") {
      throw new ToolArgError("invalid since: expected a non-empty string");
    }
    out.since = rec.since;
  }

  if (rec.diff !== undefined) {
    if (typeof rec.diff !== "boolean") {
      throw new ToolArgError("invalid diff: expected boolean");
    }
    out.diff = rec.diff;
  }

  if (rec.paths !== undefined) {
    if (!Array.isArray(rec.paths) || !rec.paths.every((item) => typeof item === "string")) {
      throw new ToolArgError("invalid paths: expected string[]");
    }
    out.paths = rec.paths.slice();
  }

  if (rec.ignore !== undefined) {
    out.ignore = asStringList(rec.ignore, "ignore");
    out.fromUser.ignore = true;
  }

  if (rec.include !== undefined) {
    out.include = asStringList(rec.include, "include");
    out.fromUser.include = true;
  }

  if (rec.format !== undefined) {
    if (typeof rec.format !== "string") {
      throw new ToolArgError("invalid format: expected string");
    }
    out.format = rec.format;
    out.fromUser.format = true;
  }

  if (rec.noMap !== undefined) {
    if (typeof rec.noMap !== "boolean") {
      throw new ToolArgError("invalid noMap: expected boolean");
    }
    out.noMap = rec.noMap;
    out.fromUser.map = true;
  }

  return out;
}

function rejectUnsafeListedPaths(absRoot: string, listed: string[]): string | null {
  for (const item of listed) {
    const resolved = resolveListedPath(absRoot, item);
    if (!resolved.ok && (resolved.reason === "absolute" || resolved.reason === "outside-root")) {
      return skipNote(resolved.reason, item).replace(/^skipping/, "rejecting");
    }
  }
  return null;
}

function parsePackFormat(value: string | undefined): OutputFormat {
  if (value == null) return "md";
  const v = value.toLowerCase();
  if (v === "md" || v === "markdown") return "md";
  if (v === "json") return "json";
  throw new ToolArgError("invalid format: expected md|json");
}

function parseListFormat(value: string | undefined): ListFormat {
  if (value == null) return "json";
  const v = value.toLowerCase();
  if (v === "json") return "json";
  if (v === "plain" || v === "text" || v === "txt" || v === "md" || v === "markdown") return "plain";
  throw new ToolArgError("invalid format: expected json|plain");
}

function runPack(
  cwd: string,
  args: ParsedToolArgs,
  kind: "pack" | "list",
): { result: PackResult; format: OutputFormat } {
  const rootResult = resolveToolRoot(cwd, args.path);
  if (!rootResult.ok) {
    throw new ToolArgError(rootResult.error);
  }
  const root = rootResult.root;

  if (args.paths) {
    const unsafe = rejectUnsafeListedPaths(root, args.paths);
    if (unsafe) throw new ToolArgError(unsafe);
  }

  if (args.diff && !args.since) {
    throw new ToolArgError("diff requires since");
  }

  let loaded: LoadedConfig | null = null;
  try {
    loaded = loadProjectConfig(root);
  } catch (err) {
    const message = err instanceof ConfigError || err instanceof Error ? err.message : String(err);
    throw new ToolArgError(message);
  }

  const requestedFormat = args.fromUser.format
    ? kind === "list"
      ? parseListFormat(args.format) === "json"
        ? "json"
        : "plain"
      : parsePackFormat(args.format)
    : kind === "list"
      ? "json"
      : "md";

  const merged = mergeConfigWithCli(
    loaded,
    {
      budget: args.budget ?? DEFAULT_BUDGET,
      format: requestedFormat,
      ignore: args.ignore ?? [],
      include: args.include ?? [],
      quiet: true,
      redact: true,
      focus: args.focus ?? [],
      map: args.noMap !== true,
    },
    {
      budget: args.fromUser.budget,
      format: args.fromUser.format,
      ignore: args.fromUser.ignore,
      include: args.fromUser.include,
      quiet: true,
      redact: false,
      focus: args.fromUser.focus,
      map: args.fromUser.map,
    },
  );

  const packOptions = {
    budget: merged.budget === 0 ? null : merged.budget,
    ignore: merged.ignore,
    include: merged.include,
    maxFileBytes: merged.maxFileBytes,
    since: args.since,
    diff: args.diff,
    paths: args.paths,
    redact: merged.redact,
    focus: parseFocusTerms(merged.focus),
    map: merged.map,
  };

  if (args.since || args.diff) {
    const packResult = pack(root, packOptions as Parameters<typeof pack>[1] & { since: string });
    if (!packResult.ok) {
      throw new ToolArgError(packResult.error.message);
    }
    return { result: packResult.value, format: merged.format };
  }

  return { result: pack(root, packOptions), format: merged.format };
}

function withNotes(body: string, notes: string[]): string {
  if (notes.length === 0) return body;
  const header = notes.map((n) => `contextpack: ${n}`).join("\n");
  return `${header}\n\n${body}`;
}

function textResult(text: string, isError = false): ToolCallResult {
  return isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] };
}

export function callTool(cwd: string, name: string, rawArgs: unknown): ToolCallResult {
  try {
    if (name !== "pack" && name !== "list") {
      return textResult(`unknown tool: ${name}`, true);
    }

    const args = parseToolArgs(rawArgs);
    const { result, format } = runPack(cwd, args, name);

    if (name === "list") {
      const listFormat: ListFormat = format === "json" ? "json" : "plain";
      return textResult(withNotes(formatList(result, listFormat), result.notes));
    }

    return textResult(withNotes(formatPack(result, format), result.notes));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return textResult(message, true);
  }
}
