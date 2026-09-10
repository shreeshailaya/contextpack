# CI pending (one-time auth scope)

The GitHub Actions workflow is ready at [`ci/github-actions.yml`](./ci/github-actions.yml).

The OAuth token used to publish this repo lacked the `workflow` scope, so GitHub rejected pushes under `.github/workflows/`.

## Enable CI

```bash
gh auth refresh -h github.com -s workflow,repo
mkdir -p .github/workflows
cp ci/github-actions.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable GitHub Actions"
git push origin master
git rm CI_PENDING.md && git commit -m "docs: remove CI pending note" && git push
```

Workflow runs `npm ci`, typecheck, tests, build, and a CLI smoke pack on Node 18/20/22.
