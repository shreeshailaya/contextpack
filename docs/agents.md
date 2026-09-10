# Using contextpack with AI coding agents

contextpack generates token-budgeted codebase digests that fit cleanly in an LLM context window. This makes it useful for AI coding agents that need to understand a codebase before making changes.

## When to use contextpack

Use contextpack when an agent needs:

- **Codebase orientation** — Understanding project structure, dependencies, and conventions before a task
- **Refactor context** — Seeing which files exist and how they relate before a large change
- **Review preparation** — Getting a snapshot of what changed or what exists in a directory

## Basic usage

```bash
# Generate a context digest
contextpack pack . --budget 8000 -o context.md

# The digest includes:
# - File list with token counts
# - Prioritized file contents (README, manifests, src/ first)
# - Summary stats
```

## Integration patterns

### Pre-task context gathering

Before a complex task, generate a digest and include it in your prompt:

```bash
# Pack the relevant directory
contextpack pack ./src --budget 12000 -o context.md

# Then reference context.md in your agent prompt
```

### JSON for programmatic access

Use JSON format when you need structured access to files:

```bash
contextpack pack . --budget 8000 --format json -o context.json
```

The JSON output includes:
```json
{
  "files": [
    { "path": "src/main.ts", "tokens": 150, "content": "..." }
  ],
  "stats": { "included": 10, "truncated": 5 },
  "totalTokens": 8000
}
```

### Scoped packing

Pack only what's relevant to the task:

```bash
# Just source code
contextpack pack ./src --budget 8000

# Exclude tests when space is tight
contextpack pack . --budget 4000 --ignore 'tests/**' --ignore '**/*.test.ts'

# Focus on a specific feature
contextpack pack ./src/auth --budget 4000
```

## Budget guidelines

| Task | Suggested budget |
| --- | --- |
| Quick orientation | 4000-8000 |
| Feature implementation | 8000-16000 |
| Large refactor | 16000-32000 |
| Full codebase review | 32000+ or unlimited (`--budget 0`) |

Token estimates are `characters / 4`. Most tokenizers fall within ~20% of this estimate.

## Priority ranking

When budget is constrained, contextpack prioritizes:

1. README files
2. Package manifests (package.json, Cargo.toml, etc.)
3. Config files (tsconfig.json, etc.)
4. Source code (`src/`, `lib/`, `app/`)
5. Tests and fixtures (lowest priority)

This ensures agents see the most important context first.

## Example: Agent workflow

```bash
# 1. Agent receives task: "Refactor the auth module to use JWT"

# 2. Agent packs relevant context
contextpack pack ./src/auth --budget 8000 -o auth-context.md
contextpack pack ./src/middleware --budget 4000 -o middleware-context.md

# 3. Agent reads digests and understands:
#    - Current auth implementation
#    - Middleware patterns
#    - Dependencies and types

# 4. Agent makes informed changes
```

## Tips

- **Start with default budget** — 16k tokens is enough for most orientation tasks
- **Pack incrementally** — Pack specific directories as you need them, not the whole repo upfront
- **Use JSON for parsing** — If your agent needs to iterate over files, use `--format json`
- **Check truncated files** — The digest lists files that didn't fit; pack them separately if needed
