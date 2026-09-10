# contextpack

> Don't dump the repo into the model. Pack what matters.

A CLI that turns a codebase into a focused, token-budgeted digest—for humans reviewing code and AI agents that need context without the noise.

## Install

```bash
npx contextpack pack .
```

Or install globally:

```bash
npm install -g contextpack
```

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
```

## What it does

1. Walks the directory tree, respecting `.gitignore`
2. Filters out noise: `node_modules`, lockfiles, binaries, build artifacts, secrets
3. Ranks files by signal (README and manifests first, tests last)
4. Fits within your token budget, keeping the highest-value files
5. Outputs a structured digest (Markdown, JSON, or plain text)

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
| `-q, --quiet` | Suppress stderr summary |
| `-V, --version` | Print version |

## For AI coding agents

contextpack is designed for both humans and AI agents. Before a large refactor or when you need codebase context:

```bash
# Get a digest of the codebase structure
contextpack pack . --budget 8000 -o context.md

# Then include context.md in your prompt
```

See [docs/agents.md](./docs/agents.md) for integration patterns.

## Token estimates

Token counts are **estimates**: `characters / 4`. This is good enough for budgeting and fits most tokenizers within ~20%. It is not a model-specific tokenizer—don't use it for billing or exact context window calculations.

## Output formats

- **md** — Markdown digest with summary table and fenced code blocks. Readable by humans, parseable by agents.
- **json** — Structured payload with file contents, stats, and metadata. For pipelines and tooling.
- **plain** — Simple separators. Easy to paste or pipe.

## Philosophy

- **Pack what matters.** README, manifests, source files. Not lockfiles, not `node_modules`, not binaries.
- **Respect budgets.** When space is tight, prioritize high-signal files over test fixtures.
- **Stay honest.** Token counts are estimates. We say so.
- **Work for both audiences.** Humans need readable digests. Agents need structured context. Same tool.

## Project layout

```
src/
  cli.ts              # Commander CLI
  index.ts            # bin entry
  pack/
    collect.ts        # Walk + gitignore
    budget.ts         # Priority ranking + selection
    tokens.ts         # Token estimation
    format.ts         # md | json | plain output
    pack.ts           # Orchestrator
  ignore/defaults.ts  # Built-in ignore patterns
tests/                # Vitest
```

## Development

```bash
git clone https://github.com/shreeshailaya/contextpack.git
cd contextpack
npm install
npm test
npm run build
```

## Status

**v0.1** — CLI works: pack, ignore, budget, formats. Tests pass. Expect ranking heuristics and ignore defaults to evolve.

## License

[MIT](./LICENSE) © Shreeshail Vitkar
