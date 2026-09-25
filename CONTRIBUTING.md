# Contributing to contextpack

Thanks for helping make codebase context packing better for humans and AI agents.

## Development setup

```bash
git clone https://github.com/shreeshailaya/contextpack.git
cd contextpack
npm install
npm test
npm run build
```

- **Node.js 18+**
- Run tests before opening a PR: `npm test`
- Reproducible naive-vs-packed numbers: `npm run benchmark`
- Typecheck: `npm run lint` (or `npm run build`)

## Design principles

1. **Honest defaults** — ignore noise and secrets by default; best-effort redaction of obvious secret-looking substrings (not a scanner); document token estimates as estimates.
2. **Both audiences** — markdown should stay readable for humans; JSON should stay stable for tools.
3. **Small modules** — prefer extending `collect` / `budget` / `format` over growing the CLI surface.
4. **No surprise network** — packing is local filesystem only unless a future feature opts in explicitly.

## Pull requests

- Keep PRs focused (one concern when possible).
- Add or update tests for ignore / budget / format behavior.
- Update the README if flags or defaults change.
- Do not commit secrets, large binaries, or generated digests.

## Reporting issues

Include: OS, Node version, command line, and a minimal repro tree if ignore/budget behavior looks wrong.

## Code of conduct

Be respectful. Assume good intent. This is early OSS — clarity beats cleverness.
