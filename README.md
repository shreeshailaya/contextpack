# contextpack

**Pack any repo into clean, token-budgeted context — for humans and AI.**

`contextpack` turns a codebase into a focused digest you can read, share, or feed to a coding agent / LLM without dumping noise (`node_modules`, build artifacts, lockfile spam, binaries).

## Why

- **Humans** get a readable map of what matters in a project (onboarding, reviews, handoffs).
- **AI** gets budgeted, structured context instead of raw recursive file dumps.

## Status

Early foundation. CLI, tests, and CI are landing next.

## Planned quickstart

```bash
# coming soon
npx contextpack pack . --budget 8000 --format md
```

## License

MIT (incoming)
