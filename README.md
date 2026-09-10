# contextpack

**Pack any repo into clean, token-budgeted context — for humans and AI.**

`contextpack` turns a codebase into a focused digest you can **read**, **share**, or **feed to a coding agent / LLM** without dumping noise (`node_modules`, build artifacts, lockfile spam, binaries, secrets).

It is a practical CLI, not a demo: ignore rules, approximate token budgets, and formats meant for both people and machines.

## Why

| Audience | What you get |
| --- | --- |
| **Humans** | A readable map of what matters (onboarding, reviews, handoffs, “what changed in this tree?”). |
| **AI / agents** | Budgeted, structured context instead of raw recursive file dumps that blow the window. |

## Install

```bash
# one-shot
npx contextpack pack . --budget 8000 --format md

# or global / local
npm install -g contextpack
# from a clone:
npm install && npm run build && npm link
```

Requires **Node.js 18+**.

## Quickstart

```bash
# Markdown digest to stdout (summary on stderr)
contextpack pack .

# Cap approximate tokens and write a file
contextpack pack ./src --budget 8000 --format md --out context.md

# JSON for tooling / agents
contextpack pack . --budget 12000 --format json --out context.json

# Plain text
contextpack pack . --format plain --out context.txt
```

```bash
contextpack pack --help
```

### Useful flags

| Flag | Description |
| --- | --- |
| `[path]` | Directory to pack (default: `.`) |
| `-b, --budget <tokens>` | Max **approximate** tokens. Omit for no budget. |
| `-f, --format <md\|json\|plain>` | Output format (default: `md`) |
| `-o, --out <file>` | Write to file instead of stdout |
| `-i, --ignore <pattern>` | Extra gitignore-style pattern (repeatable) |
| `--include <pattern>` | Force-include (overrides ignores; repeatable) |
| `--max-file-bytes <n>` | Skip files larger than N bytes (default: 512 KiB) |
| `-q, --quiet` | Suppress stderr summary |

## What gets included / ignored

By default, `contextpack`:

1. Reads the project’s root **`.gitignore`** (if present).
2. Applies **built-in ignores**: VCS dirs, `node_modules`, lockfiles, build outputs, caches, binaries, archives, large media, common secret/env files, IDE junk.
3. Keeps text-like source and docs (extension + light binary heuristic).
4. Optionally applies a **token budget**, preferring high-signal paths (README, manifests, `src/`) over bulky tests/fixtures when space is tight.

Override with `--ignore` / `--include` as needed.

## Token estimates

Token counts are **estimates**: roughly `characters / 4`.

That is good enough for budgeting and ranking. It is **not** a model-specific tokenizer (OpenAI, Anthropic, etc.) and should not be used for billing or exact context-window accounting. Digests state this explicitly.

## Output formats

- **`md`** — Human-readable digest with summary table + fenced file sections (also works well as agent input).
- **`json`** — Structured payload (`files[]`, stats, truncated list) for pipelines and tools.
- **`plain`** — Simple separators, easy to paste or pipe.

## Library usage

```ts
import { pack } from "contextpack/pack";
// or after build: from "./dist/pack/pack.js"

const result = pack(".", { budget: 8000 });
console.log(result.files.map((f) => f.path));
```

## Project layout

```
src/
  cli.ts              # Commander CLI
  index.ts            # bin entry
  types.ts
  ignore/defaults.ts  # built-in ignore + text heuristics
  pack/
    collect.ts        # walk + gitignore
    budget.ts         # priority + token budget selection
    tokens.ts         # chars/4 estimate
    format.ts         # md | json | plain
    pack.ts           # orchestrator (collect → select)
tests/                # vitest
.github/workflows/ci.yml
```

Designed so daily improvements (better ranking, streaming, language-aware chunking) plug into `collect` / `budget` / `format` without rewriting the CLI.

## Development

```bash
git clone https://github.com/shreeshailaya/contextpack.git
cd contextpack
npm install
npm test
npm run build
node dist/index.js pack . --budget 4000
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Status

**v0.1** — usable CLI: pack / ignore / budget / formats, tests, CI. Expect ranking and ignore defaults to evolve; feedback welcome.

## License

[MIT](./LICENSE) © Shreeshail Vitkar
