import fs from "node:fs";
import path from "node:path";
import type { OutputFormat } from "../types.js";

/** Dedicated config filenames, preferred order at each directory. */
export const CONFIG_FILENAMES = [".contextpack.json", "contextpack.json"] as const;

const PACKAGE_JSON = "package.json";
const PACKAGE_CONFIG_KEY = "contextpack";

const SUPPORTED_KEYS = new Set([
  "budget",
  "format",
  "ignore",
  "include",
  "focus",
  "maxFileBytes",
  "map",
  "redact",
  "quiet",
]);

export class ConfigError extends Error {
  readonly path: string;

  constructor(message: string, filePath: string) {
    super(message);
    this.name = "ConfigError";
    this.path = filePath;
  }
}

/** Pack defaults from a project config file. All fields optional. */
export interface ContextpackConfig {
  budget?: number;
  format?: OutputFormat;
  ignore?: string[];
  include?: string[];
  focus?: string[];
  maxFileBytes?: number;
  map?: boolean;
  redact?: boolean;
  quiet?: boolean;
}

export interface LoadedConfig {
  config: ContextpackConfig;
  /** Absolute path of the file that supplied the config. */
  sourcePath: string;
  /** Path relative to the pack root, for stderr. */
  sourceLabel: string;
  unknownKeys: string[];
}

/** CLI-resolved pack options that config may default. */
export interface PackConfigValues {
  budget: number;
  format: OutputFormat;
  ignore: string[];
  include: string[];
  maxFileBytes?: number;
  quiet: boolean;
  redact: boolean;
  focus: string[];
  map: boolean;
}

/** True when the user passed that option on the CLI (not Commander's default). */
export type PackConfigSources = {
  [K in keyof PackConfigValues]?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function* walkDirs(startDir: string): Generator<string> {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  while (true) {
    yield dir;
    if (dir === root) return;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJsonFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`cannot read ${filePath}: ${message}`, filePath);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`invalid JSON in ${filePath}: ${detail}`, filePath);
  }
}

/** Relative path from the pack root (posix-ish display of path.relative). */
export function configLabel(sourcePath: string, packRoot: string): string {
  const rel = path.relative(path.resolve(packRoot), path.resolve(sourcePath));
  return rel === "" ? path.basename(sourcePath) : rel;
}

function parseBudget(value: unknown, sourcePath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(
      `invalid config key "budget" in ${sourcePath}: expected a non-negative number`,
      sourcePath,
    );
  }
  return Math.floor(value);
}

function parseFormat(value: unknown, sourcePath: string): OutputFormat {
  if (typeof value !== "string") {
    throw new ConfigError(
      `invalid config key "format" in ${sourcePath}: expected md|json|plain`,
      sourcePath,
    );
  }
  const v = value.toLowerCase();
  if (v === "md" || v === "json" || v === "plain") return v;
  throw new ConfigError(
    `invalid config key "format" in ${sourcePath}: expected md|json|plain`,
    sourcePath,
  );
}

function parseStringList(key: string, value: unknown, sourcePath: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.slice();
  }
  throw new ConfigError(
    `invalid config key "${key}" in ${sourcePath}: expected string or string[]`,
    sourcePath,
  );
}

function parseMaxFileBytes(value: unknown, sourcePath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new ConfigError(
      `invalid config key "maxFileBytes" in ${sourcePath}: expected a positive number`,
      sourcePath,
    );
  }
  return Math.floor(value);
}

function parseBoolean(key: string, value: unknown, sourcePath: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(
      `invalid config key "${key}" in ${sourcePath}: expected boolean`,
      sourcePath,
    );
  }
  return value;
}

function parseConfigObject(value: unknown, sourcePath: string, packRoot: string): LoadedConfig {
  if (!isPlainObject(value)) {
    throw new ConfigError(`invalid config in ${sourcePath}: expected a JSON object`, sourcePath);
  }

  const unknownKeys = Object.keys(value).filter((key) => !SUPPORTED_KEYS.has(key));
  const config: ContextpackConfig = {};

  if (Object.prototype.hasOwnProperty.call(value, "budget")) {
    config.budget = parseBudget(value.budget, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "format")) {
    config.format = parseFormat(value.format, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "ignore")) {
    config.ignore = parseStringList("ignore", value.ignore, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "include")) {
    config.include = parseStringList("include", value.include, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "focus")) {
    config.focus = parseStringList("focus", value.focus, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "maxFileBytes")) {
    config.maxFileBytes = parseMaxFileBytes(value.maxFileBytes, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "map")) {
    config.map = parseBoolean("map", value.map, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "redact")) {
    config.redact = parseBoolean("redact", value.redact, sourcePath);
  }
  if (Object.prototype.hasOwnProperty.call(value, "quiet")) {
    config.quiet = parseBoolean("quiet", value.quiet, sourcePath);
  }

  return {
    config,
    sourcePath,
    sourceLabel: configLabel(sourcePath, packRoot),
    unknownKeys,
  };
}

/**
 * Load project pack defaults, walking from `startDir` toward the filesystem root.
 *
 * Preference: `.contextpack.json`, then `contextpack.json`, at each directory.
 * If none exist, the nearest `package.json` with a `"contextpack"` key is used.
 * Returns null when nothing is found.
 */
export function loadProjectConfig(startDir: string): LoadedConfig | null {
  const packRoot = path.resolve(startDir);

  for (const dir of walkDirs(packRoot)) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) {
        return parseConfigObject(readJsonFile(candidate), candidate, packRoot);
      }
    }
  }

  for (const dir of walkDirs(packRoot)) {
    const pkgPath = path.join(dir, PACKAGE_JSON);
    if (!isFile(pkgPath)) continue;
    const parsed = readJsonFile(pkgPath);
    if (!isPlainObject(parsed)) {
      throw new ConfigError(`invalid config in ${pkgPath}: expected a JSON object`, pkgPath);
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, PACKAGE_CONFIG_KEY)) {
      continue;
    }
    return parseConfigObject(parsed[PACKAGE_CONFIG_KEY], pkgPath, packRoot);
  }

  return null;
}

/**
 * Merge config defaults with CLI values. A flag the user passed replaces
 * the config value for that option; otherwise config fills in.
 */
export function mergeConfigWithCli(
  loaded: LoadedConfig | null,
  cli: PackConfigValues,
  fromCli: PackConfigSources,
): PackConfigValues {
  const cfg = loaded?.config ?? {};
  return {
    budget: fromCli.budget ? cli.budget : (cfg.budget ?? cli.budget),
    format: fromCli.format ? cli.format : (cfg.format ?? cli.format),
    ignore: fromCli.ignore ? cli.ignore : (cfg.ignore ?? cli.ignore),
    include: fromCli.include ? cli.include : (cfg.include ?? cli.include),
    maxFileBytes: fromCli.maxFileBytes ? cli.maxFileBytes : (cfg.maxFileBytes ?? cli.maxFileBytes),
    quiet: fromCli.quiet ? cli.quiet : (cfg.quiet ?? cli.quiet),
    redact: fromCli.redact ? cli.redact : (cfg.redact ?? cli.redact),
    focus: fromCli.focus ? cli.focus : (cfg.focus ?? cli.focus),
    map: fromCli.map ? cli.map : (cfg.map ?? cli.map),
  };
}

export function formatUnknownKeysWarning(loaded: LoadedConfig): string | null {
  if (loaded.unknownKeys.length === 0) return null;
  return `unknown config keys in ${loaded.sourceLabel}: ${loaded.unknownKeys.join(", ")} (ignored)`;
}
