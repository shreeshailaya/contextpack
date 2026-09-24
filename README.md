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

# Pack only files matching a search (agent workflow)
rg -l 'JWT|auth' -g '*.ts' | contextpack pack . --budget 8000

# Explicit path list from a file (does not also read stdin)
contextpack pack . --paths-from changed.txt --budget 4000 -o context.md

# Preview the selected paths under budget
contextpack pack . --paths-from paths.txt --list
```

## What it does

1. Walks the directory tree, respecting `.gitignore` and optional agent ignore files at the pack root (`.cursorignore`, `.aiignore`, `.copilotignore`) — or, with a piped path list / `--paths-from`, resolves only an explicit path list (no tree walk)
2. Filters out noise: `node_modules`, lockfiles, binaries, build artifacts, secrets
3. Optionally filters to only git-changed files with `--since`. Combined with a piped list or `--paths-from`, packs the intersection
4. With `--diff`, packs unified diffs of those changes instead of full file bodies (untracked files stay full content)
5. Ranks files by signal (README and manifests first, tests last)
6. Fits within your token budget, keeping the highest-value files
7. When a file doesn't fully fit, includes a useful prefix (marked as partial) rather than dropping it entirely
8. Outputs a structured digest (Markdown, JSON, or plain text)

Ignore layers (gitignore syntax), applied in this order:

`DEFAULT_IGNORES` → `.gitignore` → `.cursorignore` → `.aiignore` → `.copilotignore` → CLI `--ignore`

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
| `-q, --quiet` | Suppress stderr summary |
| `-V, --version` | Print version |

## For AI coding agents

contextpack is designed for both humans and AI agents. Before a large refactor or when you need codebase context:

```bash
# Get a digest of the codebase structure
contextpack pack . --budget 8000 -o context.md

# Then include context.md in your prompt
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

## Token estimates

Token counts are **estimates**: `characters / 4`. This is good enough for budgeting and fits most tokenizers within ~20%. It is not a model-specific tokenizer—don't use it for billing or exact context window calculations.

## Honest numbers

Measured on `fixtures/demo-project` with `npm run benchmark` (chars/4 estimates, not a model tokenizer):

- **Naive dump** — every text-ish file, no gitignore, no ranking: 8 files, ~1,649 tokens
- **Packed** — default ignores; budget 500, 2000, or unlimited: 5 files, ~161 tokens (−90%)

The packed tree fits in a 500-token budget, so that 90% is noise filtering (`vendor/`, `build/`, lockfile), not truncation. On this repo's own `src/`, unlimited pack matches a naive dump (already clean); a tight budget then truncates.

Methodology and the full table: [docs/benchmark.md](docs/benchmark.md). Re-run with `npm run benchmark`.

## Output formats

- **md** — Markdown digest with summary table and fenced code blocks. Readable by humans, parseable by agents.
- **json** — Structured payload with file contents, stats, and metadata. For pipelines and tooling.
- **plain** — Simple separators. Easy to paste or pipe.

## Philosophy

- **Pack what matters.** README, manifests, source files. Not lockfiles, not `node_modules`, not binaries.
- **Respect budgets.** When space is tight, prioritize high-signal files over test fixtures. When a high-priority file doesn't fully fit, include what does (partial inclusion) rather than losing it entirely.
- **Stay honest.** Token counts are estimates (`chars / 4`). We say so. Partial files are clearly marked.
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
    pack.ts           # Orchestrator
    pathsFrom.ts      # --paths-from parse + path safety
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

**v0.1.11** — Piped path lists (non-TTY stdin) pack like `--paths-from -` without the flag. Interactive `pack .` still walks the tree. `--paths-from` remains the explicit form. `contextpack init` writes drop-in Cursor rule + skill files. CLI: pack, init, ignore, budget, formats, `--list`, `--diff`. Reproducible naive-vs-packed benchmark. Tests pass. Token counts remain characters/4 estimates. Expect ranking heuristics and ignore defaults to evolve.

## License

[MIT](./LICENSE) © Shreeshail Vitkar
