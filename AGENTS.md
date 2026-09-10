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
```

See [docs/agents.md](./docs/agents.md) for detailed integration patterns.

## Project structure

```
src/
  cli.ts              # Commander CLI entry
  index.ts            # bin entry
  types.ts            # TypeScript interfaces
  pack/
    pack.ts           # Main orchestrator
    collect.ts        # File discovery + gitignore
    budget.ts         # Priority ranking + selection
    tokens.ts         # Token estimation (chars/4)
    format.ts         # Output formatters (md/json/plain)
  ignore/defaults.ts  # Built-in ignore patterns
tests/                # Vitest tests
docs/                 # Documentation
```

## Development commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run tests
npm run dev          # Run with tsx (no build needed)
```

## Making changes

- Run `npm test` before committing
- Token counts are estimates (chars/4) — don't claim precision
- Priority ranking in `budget.ts` affects which files win under tight budgets
- Default ignores in `ignore/defaults.ts` filter noise (node_modules, lockfiles, etc.)
