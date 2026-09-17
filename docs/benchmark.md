# Benchmark: naive dump vs contextpack

Reproducible comparison of **dumping every text-ish file** against **packing** the same tree. Token figures are estimates (`characters / 4`), the same heuristic `pack()` uses. They are not a model tokenizer.

## How to run

From the repo root, after `npm install`:

```bash
npm run benchmark
```

That runs `tsx scripts/benchmark.ts`. The script calls `naiveDump()` and the library `pack()` in-process — it does not shell out to a published `contextpack` binary.

Primary subject: `fixtures/demo-project` (in-repo, deterministic).

Secondary subject: this repo’s `src/` (printed live; counts move when source changes, so they are not a frozen claim).

## Methodology

### Token estimate

For each file, tokens = `ceil(character_length / 4)`. The benchmark **sums per-file estimates**, matching `pack()`.

This is good enough for budgeting. It is not tiktoken, SentencePiece, or a billed tokenizer.

### What “naive dump” includes

A naive dump is the thing people do instead of packing: walk the tree and keep every text-ish file.

Included:

- Files with known text extensions/basenames (same lists as collect), plus extensionless files that look like text
- Lockfiles, `vendor/`, `build/`, tests — **no** `.gitignore`, **no** default ignore list, **no** ranking, **no** budget

Excluded (not “dump the source”):

- `.git/` (opaque VCS objects)
- Symlinks, non-files, unreadable files
- Files containing a NUL byte (treated as binary)

See `src/pack/naive.ts`.

### What “packed” does

`pack(root, { budget })` from `src/pack/pack.ts`:

- Respects `.gitignore` and `DEFAULT_IGNORES` (`vendor/`, `build/`, lockfiles, `node_modules/`, secrets, …)
- Ranks files when a positive budget is set (README and manifests first, tests last)
- `budget: 0` is unlimited (CLI `--budget 0`)

### What this fixture is for

`fixtures/demo-project` is a **small, illustrative** tree: a handful of source files plus committed stand-ins for install/build noise (`vendor/pad-lib`, `build/bundle.js`, `package-lock.json`). It is not a substitute for measuring a production repo. Real trees with `node_modules/` save more on noise than this fixture does.

## Results (fresh local run)

Recorded from `npm run benchmark` on 2026-09-17, contextpack **0.1.7**, Node 18+ compatible script. Re-run to refresh.

### `fixtures/demo-project` (primary)

| Mode | Files | ~Tokens (est.) | vs naive | Truncated | Partial |
| --- | ---: | ---: | ---: | ---: | ---: |
| Naive dump | 8 | 1,649 | — | — | — |
| Pack budget 500 | 5 | 161 | −90% | 0 | 0 |
| Pack budget 2000 | 5 | 161 | −90% | 0 | 0 |
| Pack unlimited (0) | 5 | 161 | −90% | 0 | 0 |

Naive dump files (~tokens est.): `build/bundle.js` (751), `vendor/pad-lib/index.js` (662), `package-lock.json` (75), `tests/utils.test.js` (55), `README.md` (35), `package.json` (33), `src/utils.js` (21), `src/index.js` (17).

Packed files (all three budgets): `README.md`, `package.json`, `src/index.js`, `src/utils.js`, `tests/utils.test.js`. Dropped vs naive: `build/bundle.js`, `vendor/pad-lib/index.js`, `package-lock.json`.

The packed tree is ~161 estimated tokens, so a 500-token budget already keeps everything contextpack would keep. **The 90% reduction vs naive dump is ignore-filtering, not truncation.** That is the honest reading.

### `src/` (secondary snapshot — will drift)

Same run. Unlimited pack matches naive dump because `src/` is already a clean tree (no vendor/lockfile/build). Tight budgets then truncate. Do not treat these as a product claim; they change when files in `src/` change.

| Mode | Files | ~Tokens (est.) | vs naive | Truncated | Partial |
| --- | ---: | ---: | ---: | ---: | ---: |
| Naive dump | 11 | 12,443 | — | — | — |
| Pack budget 500 | 3 | 500 | −96% | 9 | 1 |
| Pack budget 2000 | 5 | 2,000 | −84% | 7 | 1 |
| Pack unlimited (0) | 11 | 12,443 | 0% | 0 | 0 |

## Caveats

- Estimates ≠ model tokenizer. Don’t use these figures for billing or exact context-window math.
- The demo fixture is small. It includes a few noise files so the naive-vs-packed gap is visible without checking in a real `node_modules/`.
- A dump of a real repo that contains `node_modules/`, lockfiles, and build output will look worse for the naive side than this fixture.
- On an already-clean directory, unlimited `pack()` ≈ naive dump. Savings then come from `--budget`, `--since`, and extra `--ignore`.
- `src/` numbers above are a snapshot of this commit, not a stable benchmark target.

## Related

- Qualitative before/after of the same fixture: [demo.md](./demo.md)
- Token-estimate policy: README “Token estimates”
