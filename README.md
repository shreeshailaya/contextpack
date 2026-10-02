# contextpack

> Don't dump the repo into the model. Pack what matters.

A CLI that turns a codebase into a focused, token-budgeted digest—for humans reviewing code and AI agents that need context without the noise.

## Install

```bash
npx -p @shree_vitkar/contextpack contextpack pack .
```

Or install globally:

```bash
npm install -g @shree_vitkar/contextpack
contextpack pack .
```

### Windows

The recommended approach on Windows is using `npx`, which requires no PATH configuration:

```cmd
npx -p @shree_vitkar/contextpack contextpack pack .
```

To install globally:

```cmd
npm install -g @shree_vitkar/contextpack
contextpack pack .
```

**If `contextpack` is not recognized after global install:**

1. Find your npm global bin directory:
   ```cmd
   npm config get prefix
   ```
   This is usually `%AppData%\npm` (e.g., `C:\Users\YourName\AppData\Roaming\npm`).

2. Add that path to your User PATH environment variable:
   - Press `Win + R`, type `sysdm.cpl`, press Enter
   - Go to **Advanced** → **Environment Variables**
   - Under **User variables**, edit **Path** and add the npm prefix path

3. Restart your terminal (CMD, PowerShell, or Git Bash).

4. Verify the CLI wrapper exists:
   ```cmd
   dir "%AppData%\npm\contextpack*"
   ```
   You should see `contextpack` and `contextpack.cmd`.

> **Note:** The package is scoped `@shree_vitkar/contextpack` but the CLI binary name is `contextpack`.

## Usage

```bash
# Pack current directory to stdout
contextpack pack .

# Budget to ~8k tokens, write to file
contextpack pack ./src --budget 8000 -o context.md

# JSON output for tooling
contextpack pack . --budget 12000 --format json -o context.json

# Skip tests and fixtures
contextpack pack . --ignore 'tests/**' --ignore 'fixtures/**'

# Preview which files would be included (dry-run)
contextpack pack . --list --budget 8000

# Only files changed since main branch
contextpack pack . --since main --budget 8000

# Preview changes from last commit
contextpack pack . --since HEAD~1 --list

# Pack unified diffs of changes since main (cheaper than full files)
contextpack pack . --since main --diff

# Boost files matching a topic (substring on path or content; ranking only)
contextpack pack . --focus auth,jwt --budget 4000

# Preview a topic-ranked pack
contextpack pack . --focus "login session" --list

# Pack only files matching a search (agent workflow)
rg -l 'JWT|auth' -g '*.ts' | contextpack pack . --budget 8000

# Explicit path list from a file (does not also read stdin)
contextpack pack . --paths-from changed.txt --budget 4000 -o context.md

# Preview the selected paths under budget
contextpack pack . --paths-from paths.txt --list

# Keep raw values (trusted local debug / inspect a false positive)
contextpack pack . --no-redact

# Bodies only (skip the digest map and its budget reserve)
contextpack pack . --no-map --budget 4000

# Skip project config for one invocation
contextpack pack . --no-config --budget 4000
```

Optional **project config** sets pack defaults so you do not repeat the same flags. Walk from the pack root upward and stop at the first match: `.contextpack.json`, then `contextpack.json`. If neither exists, a `"contextpack"` key in the nearest `package.json` uses the same schema.

```json
{
  "budget": 8000,
  "format": "md",
  "ignore": ["fixtures/**"],
  "focus": ["auth", "jwt"]
}
```

CLI flags always win. `--since`, `--diff`, `--out`, `--list`, and `--paths-from` stay on the command line (not config keys). `--no-config` skips the file.

## What it does

1. Walks the directory tree, respecting `.gitignore` and optional agent ignore files at the pack root (`.cursorignore`, `.aiignore`, `.copilotignore`) — or, with a piped path list / `--paths-from`, resolves only an explicit path list (no tree walk)
2. Filters out noise: `node_modules`, lockfiles, binaries, build artifacts, secrets
3. Optionally filters to only git-changed files with `--since`. Combined with a piped list or `--paths-from`, packs the intersection
4. With `--diff`, packs unified diffs of those changes instead of full file bodies (untracked files stay full content)
5. Ranks files by signal (README and manifests first, tests last). `--focus` boosts files whose path or packed content contains those keywords (substring, not semantic search) — ranking only, not a filter
6. Fits within your token budget, keeping the highest-value files
7. When a file doesn't fully fit, includes a useful prefix (marked as partial) rather than dropping it entirely
8. Redacts obvious secret-looking substrings in file bodies and diffs (best-effort; `--no-redact` to disable)
9. Reserves a compact **Map** of discovered candidates from the budget (included / partial / truncated / skipped), then fits file bodies in what remains. `--no-map` skips the map
10. Outputs a structured digest (Markdown, JSON, or plain text)

Ignore layers (gitignore syntax), applied in this order:

`DEFAULT_IGNORES` → `.gitignore` → `.cursorignore` → `.aiignore` → `.copilotignore` → extra ignores (project config `ignore`, or CLI `--ignore` if you passed the flag — CLI replaces config)

Agent ignore files are optional and only read from the pack root when present (not nested per-directory). `--include` still force-includes matched paths and wins over ignores.

## Flags

| Flag | Description |
| --- | --- |
| `[path]` | Directory to pack (default: `.`) |
| `-b, --budget <n>` | Max tokens (~chars/4). Default: 16000. Use `0` for unlimited. |
| `-f, --format <fmt>` | `md` (default), `json`, or `plain` |
| `-o, --out <file>` | Write to file instead of stdout |
| `-i, --ignore <pat>` | Extra ignore pattern (repeatable) |
| `--include <pat>` | Force-include pattern (repeatable) |
| `--max-file-bytes <n>` | Skip files larger than N bytes (default: 512KB) |
| `-l, --list` | Preview which files would be included without dumping contents |
| `-s, --since <ref>` | Only include files changed since git ref (e.g. `main`, `HEAD~1`) |
| `--diff` | With `--since`, pack unified diffs of tracked changes instead of full files |
| `--paths-from <file>` | Pack only paths listed in a file (one per line; `-` reads stdin). Piped stdin without this flag is the same as `-`. No tree walk |
| `--no-redact` | Disable best-effort secret redaction (keep raw values; useful to inspect a false positive locally) |
| `--focus <terms>` | Boost ranking for files matching keywords (comma/space-separated substring on path or content; repeatable). Ranking only — not a filter, not semantic search |
| `--no-map` | Omit the digest map and do not reserve map tokens from the budget. `--list` still previews files |
| `--no-config` | Skip project config (`.contextpack.json` / `contextpack.json` / `package.json`) |
| `-q, --quiet` | Suppress stderr summary |
| `-V, --version` | Print version |

## For AI coding agents

contextpack is designed for both humans and AI agents. Before a large refactor or when you need codebase context:

```bash
# Get a digest of the codebase structure
contextpack pack . --budget 8000 -o context.md

# Boost files matching a topic (substring on path or content; ranking only)
contextpack pack . --focus auth,jwt --budget 4000 -o context.md
```

### Agent setup

Drop Cursor / Claude integration files into a repo so agents know when and how to run contextpack:

```bash
npx -p @shree_vitkar/contextpack contextpack init
```

Writes (create only if missing; `--force` overwrites):

- `.cursor/rules/contextpack.mdc` — when/how to pack
- `skills/contextpack/SKILL.md` — skill with the real install/run commands

Add `--agents` to create or append a short `AGENTS.md` section.

See [docs/agents.md](./docs/agents.md) for integration patterns.

## GitHub Action (PR digest)

On `pull_request`, pack only what changed since the base SHA (`--since` + `--diff`) and post a short comment. The full digest is a workflow artifact — not a dump of the whole repo.

```yaml
# .github/workflows/contextpack-pr.yml
name: contextpack PR
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  pack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: shreeshailaya/contextpack/.github/actions/pack-pr@master
```

This repo runs the same job from [`.github/workflows/contextpack-pr.yml`](./.github/workflows/contextpack-pr.yml) (local `uses: ./.github/actions/pack-pr`). Copy the Action directory into another repo if you do not want to reference this one.

Inputs, permissions, and failure modes: [docs/github-action.md](./docs/github-action.md).

## Secrets

Path ignores already skip `.env`, `*.pem`, and similar files. Packed **contents** (full files and unified diffs) also get **best-effort redaction** of obvious secret-looking substrings: PEM private-key blocks, GitHub / OpenAI / Slack / AWS-access-key prefixes, `Bearer` tokens, and common `api_key=` / `password=` / `token=` assignments.

This is not a security scanner. Short placeholders (`YOUR_API_KEY`, `changeme`) are left alone. The digest summary reports `redacted: N` when anything was replaced. Use `--no-redact` when you need the raw text (for example, to inspect a false positive locally). Do not treat a digest as proof that secrets are absent.

`--list` still has no file bodies, so it does not redact snippets (there are none). Token estimates in `--list` match a real pack, including redaction.

## Token estimates

Token counts are **estimates**: `characters / 4`. This is good enough for budgeting and fits most tokenizers within ~20%. It is not a model-specific tokenizer—don't use it for billing or exact context window calculations.

The digest **Map** uses the same estimate. Its tokens are reserved from `--budget` before file bodies are selected so the inventory does not silently overflow. `totalTokens` is still the sum of included file bodies. `--no-map` turns that reserve off.

## Honest numbers

Measured on `fixtures/demo-project` with `npm run benchmark` (chars/4 estimates, not a model tokenizer):

- **Naive dump** — every text-ish file, no gitignore, no ranking: 8 files, ~1,649 tokens
- **Packed** — default ignores; budget 500, 2000, or unlimited: 5 files, ~161 tokens (−90%)

The packed tree fits in a 500-token budget, so that 90% is noise filtering (`vendor/`, `build/`, lockfile), not truncation. On this repo's own `src/`, unlimited pack matches a naive dump (already clean); a tight budget then truncates.

Methodology and the full table: [docs/benchmark.md](docs/benchmark.md). Re-run with `npm run benchmark`.

## Output formats

- **md** — Markdown digest with summary table, a **Map** of discovered candidates (included vs left out), and fenced code blocks. Readable by humans, parseable by agents.
- **json** — Structured payload with `map`, file contents, stats, and metadata. For pipelines and tooling.
- **plain** — Simple separators plus the same map. Easy to paste or pipe.

The map is the cheap inventory: every discovered candidate, marked `included` / `partial` / `truncated` / `skipped`. `--list` is that same inventory without file bodies. Map tokens are reserved from the budget (chars÷4 of the compact map text) so adding the map does not silently overflow. `totalTokens` remains file bodies only. If the map itself is larger than the budget, the digest still includes the map and omits bodies.

## Philosophy

- **Pack what matters.** README, manifests, source files. Not lockfiles, not `node_modules`, not binaries.
- **Respect budgets.** When space is tight, prioritize high-signal files over test fixtures. When a high-priority file doesn't fully fit, include what does (partial inclusion) rather than losing it entirely.
- **Stay honest.** Token counts are estimates (`chars / 4`). We say so. Partial files are clearly marked. The map is reserved from the budget so orientation stays cheap without pretending bodies still fit.
- **Work for both audiences.** Humans need readable digests. Agents need structured context. Same tool.

## Project layout

```
src/
  cli.ts              # Commander CLI
  index.ts            # bin entry
  init/               # contextpack init (agent drop-in files)
  pack/
    collect.ts        # Walk + gitignore / agent ignores; optional explicit path list
    budget.ts         # Priority ranking + selection
    tokens.ts         # Token estimation
    naive.ts          # Naive dump (benchmark baseline)
    format.ts         # md | json | plain output
    map.ts            # Digest map (inventory + budget reserve)
    pack.ts           # Orchestrator
    pathsFrom.ts      # --paths-from parse + path safety
    redact.ts         # Best-effort secret redaction
    focus.ts          # --focus term parse + substring match
    config.ts         # .contextpack.json / package.json defaults
  ignore/defaults.ts  # Built-in ignore patterns
tests/                # Vitest
scripts/
  benchmark.ts        # Naive dump vs packed budgets
.github/actions/pack-pr/  # Composite Action: PR --since --diff digest
```

## Development

```bash
git clone https://github.com/shreeshailaya/contextpack.git
cd contextpack
npm install
npm test
npm run build
npm run benchmark
```

## Status

**v0.1.15** — Optional project config: `.contextpack.json` (or `contextpack.json`, or a `"contextpack"` key in `package.json`) sets pack defaults (budget, format, ignore, include, focus, maxFileBytes, map, redact, quiet). Walks from the pack root upward and stops at the first match. CLI flags always win. `--no-config` skips it. Invocation-specific options (`--since`, `--diff`, `--out`, `--list`, `--paths-from`) stay on the CLI. Token counts remain characters/4 estimates.

## License

[MIT](./LICENSE) © Shreeshail Vitkar
