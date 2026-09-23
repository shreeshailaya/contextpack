# Agent Instructions

This file contains instructions for AI coding agents working on contextpack.

## What is contextpack?

A CLI tool that packs a codebase into a token-budgeted digest. Useful for:
- Humans reviewing or onboarding to a codebase
- AI agents that need codebase context before making changes

## Install

```bash
npx -p @shree_vitkar/contextpack contextpack pack .
```

Or install globally:

```bash
npm install -g @shree_vitkar/contextpack
contextpack pack .
```

## Using contextpack as an agent

Before large refactors or when you need codebase orientation:

```bash
# Pack the codebase or relevant directory
contextpack pack . --budget 8000 -o context.md

# Pack specific directories for focused context
contextpack pack ./src --budget 12000

# JSON format for programmatic access
contextpack pack . --format json --budget 8000

# Pack only files an agent already found (e.g. ripgrep)
rg -l 'JWT|auth' -g '*.ts' | contextpack pack . --paths-from - --budget 8000
```

See [docs/agents.md](./docs/agents.md) for detailed integration patterns.

PR review on GitHub: a composite Action packs `--since <base> --diff` and posts a comment. See [docs/github-action.md](./docs/github-action.md).

## Project structure

```
src/
  cli.ts              # Commander CLI entry
  index.ts            # bin entry
  types.ts            # TypeScript interfaces
  init/               # contextpack init (agent drop-in files)
  pack/
    pack.ts           # Main orchestrator
    collect.ts        # File discovery + gitignore; optional --paths-from list
    budget.ts         # Priority ranking + selection
    tokens.ts         # Token estimation (chars/4)
    naive.ts          # Naive dump (benchmark baseline)
    format.ts         # Output formatters (md/json/plain)
    pathsFrom.ts      # --paths-from parse + path safety
  ignore/defaults.ts  # Built-in ignore patterns
tests/                # Vitest tests
docs/                 # Documentation
.github/actions/pack-pr/  # Composite Action: PR --since --diff digest
```

## Development commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run tests
npm run benchmark    # Naive dump vs packed budgets
npm run dev          # Run with tsx (no build needed)
```

## Making changes

- Run `npm test` before committing
- Token counts are estimates (chars/4) — don't claim precision
- Priority ranking in `budget.ts` affects which files win under tight budgets
- Default ignores in `ignore/defaults.ts` filter noise (node_modules, lockfiles, etc.)
