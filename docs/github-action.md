# GitHub Action: pack a PR with contextpack

A composite Action that runs the published CLI on `pull_request`:

```bash
npx -p @shree_vitkar/contextpack@<version> contextpack pack . --since <base.sha> --diff --budget <budget> --format md
```

It writes a budgeted digest, uploads it as a workflow artifact, and posts (or updates) a short PR comment. The comment is a summary plus a file list — the full digest stays in the artifact so the thread stays readable.

This repo dogfoods it via [`.github/workflows/contextpack-pr.yml`](../.github/workflows/contextpack-pr.yml).

Token counts are estimates (`characters / 4`), same as the CLI.

## Use in another repo

The Action lives in this public repo. Point `uses` at it (pin to `master` or a commit SHA):

```yaml
name: contextpack PR

on:
  pull_request:

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
        with:
          version: "0.1.12"
          budget: "12000"
```

`fetch-depth: 0` (or an explicit fetch of `github.event.pull_request.base.sha`) matters: `--since` needs the base commit. The Action tries to fetch a missing ref, but a full checkout is the reliable default.

Copy-paste instead of referencing this repo: copy [`.github/actions/pack-pr/`](../.github/actions/pack-pr/) into your repository and use `uses: ./.github/actions/pack-pr`.

Requires Node 18+ on the runner (the Action installs Node itself). It `npm install`s the pinned `@shree_vitkar/contextpack` version into a temp prefix and runs `node …/dist/index.js` — no global install and no PATH edits. `ubuntu-latest` is the intended runner.

## Permissions

| Permission | Why |
| --- | --- |
| `contents: read` | Checkout the PR |
| `pull-requests: write` | Create or update the summary comment |

Artifact upload uses the default `GITHUB_TOKEN`. If you set `comment: false`, you can drop `pull-requests: write`.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `version` | `0.1.12` | npm version of `@shree_vitkar/contextpack` installed into a temp prefix |
| `budget` | `12000` | Token budget (`chars/4`). `0` = unlimited |
| `path` | `.` | Directory to pack |
| `since` | PR base SHA | Git ref for `--since`. Falls back to `github.event.pull_request.base.sha`, then `origin/<base.ref>` |
| `diff` | `true` | Pass `--diff` (unified diffs of tracked changes; untracked files stay full content) |
| `format` | `md` | Digest format: `md`, `json`, or `plain` |
| `artifact-name` | `contextpack-pr` | Workflow artifact name |
| `artifact-path` | `contextpack-pr.md` | Digest file path (keep in sync with `format`) |
| `comment` | `true` | Post or update a PR comment. No-op when the event is not `pull_request` |
| `comment-file-limit` | `12` | Included files shown before a `<details>` collapse |
| `extra-args` | _(empty)_ | Extra `contextpack pack` flags, word-split (e.g. `--ignore tests/**`) |
| `fail-on-empty` | `false` | Fail the job when the pack includes no files |
| `fail-on-error` | `false` | Fail the job on pack errors (see below) |
| `node-version` | `20` | Node.js version for `actions/setup-node` |
| `github-token` | `${{ github.token }}` | Token used to write the PR comment |

## Outputs

| Output | Description |
| --- | --- |
| `digest-path` | Path to the digest file |
| `files` | Files included |
| `tokens` | Approximate token count |
| `since` | Ref that was packed against |
| `empty` | `true` when no files were included |
| `ok` | `true` when `contextpack pack` succeeded |
| `error` | Message when `ok` is `false` |

## Comment

The comment starts with `<!-- contextpack-pr -->`. On later pushes the Action updates that comment instead of adding a new one.

It includes:

- a one-line description of the ref, `--diff`, budget, and package version
- a summary table (files, diffs, tokens, budget %)
- the top included files from `--list`
- longer lists collapsed in `<details>`
- a pointer to the artifact for the full digest

## Failure modes

Defaults are **fail-soft**: the job stays green so a digest problem does not block the rest of PR CI. The comment (when enabled) explains what happened.

| Situation | Default | `fail-on-error: true` | `fail-on-empty: true` |
| --- | --- | --- | --- |
| Valid pack with files | success + comment + artifact | (same) | (same) |
| Valid empty pack (no changes, or all ignored) | success + comment | (same) | **job fails** (comment/artifact still happen first) |
| Not a git checkout | warning + comment; no artifact | **job fails** | — |
| Invalid or missing `--since` / base SHA | warning + comment; no artifact | **job fails** | — |
| `git`, `node`, or `npm` missing; npm install fails | warning + comment; no artifact | **job fails** | — |
| Not a `pull_request` event and `since` unset | warning; no pack | **job fails** | — |
| Comment API error (missing `pull-requests: write`) | **job fails** | — | — |

Shallow checkouts without the base commit look like an invalid ref. Use `fetch-depth: 0` or fetch `github.event.pull_request.base.sha` before this Action.

`--diff` requires `--since` (the Action always passes `--since` when it can resolve a base). Deleted files are skipped; there is nothing to pack.

## Workflow_dispatch / non-PR

Set `since` yourself (branch name, tag, or SHA). The digest and artifact still run. The comment step is skipped unless the event is `pull_request`.

```yaml
on:
  workflow_dispatch:

jobs:
  pack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: shreeshailaya/contextpack/.github/actions/pack-pr@master
        with:
          since: origin/master
          comment: false
```

## Pinning

`version` pins the **npm** package. `uses: …@master` (or a commit SHA) pins the **Action** YAML. Bump `version` when you want a newer CLI; pin `uses` to a SHA when you want the Action steps frozen.
