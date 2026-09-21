/** Output formats supported by contextpack. */
export type OutputFormat = "md" | "json" | "plain";

/** Output formats for --list preview (plain text table or json). */
export type ListFormat = "plain" | "json";

/** Whether packed content is a full file body or a unified git diff. */
export type PackedFileKind = "file" | "diff";

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
  /** Summary stats. */
  stats: {
    discovered: number;
    included: number;
    ignored: number;
    truncated: number;
    skipped: number;
  };
  /**
   * Stderr-worthy skip notes (missing / absolute / outside-root listed paths).
   * Empty when unused. Not part of the digest body.
   */
  notes: string[];
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
