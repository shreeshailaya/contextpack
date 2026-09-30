/** Output formats supported by contextpack. */
export type OutputFormat = "md" | "json" | "plain";

/** Output formats for --list preview (plain text table or json). */
export type ListFormat = "plain" | "json";

/** Whether packed content is a full file body or a unified git diff. */
export type PackedFileKind = "file" | "diff";

/** Status of one discovered candidate in the digest map / `--list` preview. */
export type DigestMapStatus = "included" | "partial" | "truncated" | "skipped";

/** One row in the compact digest map (same statuses as `--list`). */
export interface DigestMapEntry {
  /** Path relative to the pack root. */
  path: string;
  status: DigestMapStatus;
  /**
   * chars÷4 estimate: packed tokens for included/partial,
   * full-file tokens for truncated, 0 for skipped.
   */
  tokens: number;
  kind: PackedFileKind;
}

/** A single file selected for inclusion in a pack. */
export interface PackedFile {
  /** Path relative to the pack root. */
  path: string;
  /** File contents as UTF-8 text (binary files are skipped). */
  content: string;
  /** Approximate token estimate for this file. */
  tokens: number;
  /** Byte length of content. */
  bytes: number;
  /** True if the file was partially included due to budget constraints. */
  partial?: boolean;
  /** Full file body vs unified diff. Defaults to "file". */
  kind?: PackedFileKind;
}

/** Result of a pack operation. */
export interface PackResult {
  /** Absolute path that was packed. */
  root: string;
  /** Files included after ignore + budget selection. */
  files: PackedFile[];
  /** Total approximate tokens across included files. */
  totalTokens: number;
  /** Token budget that was applied (if any). */
  budget: number | null;
  /** Files discovered but excluded by budget. */
  truncated: string[];
  /** Files skipped as binary / unreadable. */
  skipped: string[];
  /**
   * Compact inventory of discovered candidates (included vs left out).
   * Always populated so `--list` matches the digest map. Not rendered
   * when `stats.mapTokens` is 0 (`--no-map`).
   */
  map: DigestMapEntry[];
  /** Summary stats. */
  stats: {
    discovered: number;
    included: number;
    ignored: number;
    truncated: number;
    skipped: number;
    /** Best-effort redactions applied to packed contents (0 if `--no-redact`). */
    redacted: number;
    /**
     * Candidate files whose path or packed content matched `--focus` terms.
     * 0 when `--focus` is omitted or parsed to no terms.
     */
    focused: number;
    /**
     * chars÷4 estimate of the compact map text reserved from the budget.
     * 0 when the map is omitted (`--no-map`).
     */
    mapTokens: number;
  };
  /**
   * Stderr-worthy skip notes (missing / absolute / outside-root listed paths).
   * Empty when unused. Not part of the digest body.
   */
  notes: string[];
  /**
   * Parsed `--focus` terms used for ranking. Omitted or empty = no boost.
   * Substring match, not semantic search.
   */
  focus?: string[];
}

/** Options for packing a directory. */
export interface PackOptions {
  /** Max approximate tokens. null = no budget (include everything text-like). */
  budget?: number | null;
  /** Extra ignore glob patterns (gitignore syntax). */
  ignore?: string[];
  /** Patterns that negate default ignores (force-include). */
  include?: string[];
  /** Max file size in bytes to read (default 512 KiB). */
  maxFileBytes?: number;
  /** Prefer smaller / higher-signal files when budgeting. */
  prioritize?: boolean;
  /** Only include files changed since this git ref. */
  since?: string;
  /**
   * Pack unified git diffs for tracked files changed since `since`,
   * instead of full file contents. Requires `since`. Untracked files
   * still pack as full content.
   */
  diff?: boolean;
  /**
   * Explicit paths relative to the pack root. When set, only these paths
   * are resolved — the tree is not walked. Combined with `since`, the
   * intersection of the list and changed files is packed.
   */
  paths?: string[];
  /**
   * Best-effort redaction of obvious secret-looking substrings in file
   * bodies and diffs. Default true. Not a security scanner.
   */
  redact?: boolean;
  /**
   * Keywords that boost ranking (path or packed content substring).
   * Case-insensitive. Not a filter: non-matching files can still pack if
   * budget remains. Empty / omitted = no boost. Not semantic search.
   */
  focus?: string[];
  /**
   * Include a digest map and reserve its tokens from the budget (chars/4).
   * Default true. `--no-map` disables reservation and omits the map
   * from formatted output; `--list` still previews files.
   */
  map?: boolean;
}

export interface CollectOptions {
  ignore?: string[];
  include?: string[];
  maxFileBytes?: number;
  /** Only include files changed since this git ref. */
  since?: string;
  /** Explicit paths relative to the pack root (skip the tree walk). */
  paths?: string[];
}
