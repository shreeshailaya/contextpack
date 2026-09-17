# Demo: Before and After

This demo shows the difference between dumping a directory and using contextpack.

## The problem: raw `find` + `cat`

```bash
$ find fixtures/demo-project -type f -exec cat {} \;
```

Output (no structure, no prioritization, includes noise):

```
# Demo Project

A small example project...
{
  "name": "demo-project",
...test code mixed in...
const { greet } = require('../src/utils');

test('greet returns greeting', () => {
...
```

Problems:
- No file boundaries
- No token awareness
- Tests mixed with source
- Would include node_modules, lockfiles, binaries in a real project

## The solution: contextpack

```bash
$ contextpack pack fixtures/demo-project --budget 2000
```

Output (structured, prioritized, budgeted):

```markdown
# contextpack digest

Root: `fixtures/demo-project`

## Summary

| Metric | Value |
| --- | --- |
| Files included | 5 |
| Approx. tokens | ~200 (chars÷4 estimate) |
| Budget | 2000 |

## Files

- `README.md` (~40 tok)
- `package.json` (~35 tok)
- `src/index.js` (~20 tok)
- `src/utils.js` (~25 tok)
- `tests/utils.test.js` (~50 tok)

---

## README.md

\`\`\`md
# Demo Project
...
\`\`\`

## package.json

\`\`\`json
{
  "name": "demo-project",
  ...
}
\`\`\`

(etc.)
```

## What changed?

| Aspect | Raw dump | contextpack |
| --- | --- | --- |
| File boundaries | None | Clear sections |
| Priority | Random order | README first, tests last |
| Noise filtering | Everything | Ignores node_modules, lockfiles |
| Token budget | Unknown | Explicit limit |
| Format | Messy | Markdown/JSON/plain |

## Try it yourself

```bash
cd fixtures/demo-project

# Pack with default budget
contextpack pack .

# Pack with tight budget (prioritizes README, package.json)
contextpack pack . --budget 500

# See what gets truncated
contextpack pack . --budget 200
```

For measured naive-dump vs packed token counts on this fixture, see [benchmark.md](./benchmark.md) (`npm run benchmark`).
