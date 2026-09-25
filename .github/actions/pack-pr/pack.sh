#!/usr/bin/env bash
# Resolve the PR base, run contextpack --since [--diff], write digest + list JSON.
# Never exits non-zero for pack failures; the composite Action decides whether to fail.
set -u

write_output() {
  local key="$1"
  local value="${2:-}"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    if [[ "$value" == *$'\n'* ]]; then
      printf '%s<<CPACK_EOF\n%s\nCPACK_EOF\n' "$key" "$value" >>"$GITHUB_OUTPUT"
    else
      printf '%s=%s\n' "$key" "$value" >>"$GITHUB_OUTPUT"
    fi
  fi
}

write_defaults() {
  write_output "ok" "${1:-false}"
  write_output "empty" "${2:-true}"
  write_output "error" "${3:-}"
  write_output "since" "${SINCE:-}"
  write_output "files" "${4:-0}"
  write_output "tokens" "${5:-0}"
  write_output "budget" "${CONTEXTPACK_BUDGET:-}"
  write_output "digest-path" "${CONTEXTPACK_OUT:-}"
  write_output "digest-exists" "${6:-false}"
  write_output "list-path" "${LIST_OUT:-}"
}

LIST_OUT="${CONTEXTPACK_LIST_OUT:-contextpack-pr-list.json}"
CONTEXTPACK_OUT="${CONTEXTPACK_OUT:-contextpack-pr.md}"
CONTEXTPACK_BUDGET="${CONTEXTPACK_BUDGET:-12000}"
CONTEXTPACK_PATH="${CONTEXTPACK_PATH:-.}"
CONTEXTPACK_FORMAT="${CONTEXTPACK_FORMAT:-md}"
CONTEXTPACK_VERSION="${CONTEXTPACK_VERSION:-0.1.12}"
CONTEXTPACK_DIFF="${CONTEXTPACK_DIFF:-true}"
CONTEXTPACK_EXTRA_ARGS="${CONTEXTPACK_EXTRA_ARGS:-}"

SINCE="${CONTEXTPACK_SINCE:-}"
if [[ -z "$SINCE" ]]; then
  SINCE="${PR_BASE_SHA:-}"
fi
if [[ -z "$SINCE" && -n "${PR_BASE_REF:-}" ]]; then
  SINCE="origin/${PR_BASE_REF}"
fi

if [[ -z "$SINCE" ]]; then
  echo "::warning::No base ref. Set the 'since' input or run on pull_request (uses github.event.pull_request.base.sha)."
  write_defaults false true "no base ref (not a pull_request and 'since' was not set)"
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  echo "::warning::git is not available on this runner."
  write_defaults false true "git is not available on this system"
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "::warning::Not inside a git work tree. Did the workflow check out the repo?"
  write_defaults false true "not inside a git repository"
  exit 0
fi

if ! git rev-parse --verify "${SINCE}^{commit}" >/dev/null 2>&1; then
  echo "Base ref ${SINCE} is not present locally; fetching…"
  git fetch --no-tags --depth=1 origin "$SINCE" >/dev/null 2>&1 || true
  if ! git rev-parse --verify "${SINCE}^{commit}" >/dev/null 2>&1; then
    if [[ "$SINCE" != origin/* ]] && git rev-parse --verify "origin/${SINCE}^{commit}" >/dev/null 2>&1; then
      SINCE="origin/${SINCE}"
    fi
  fi
fi

if ! git rev-parse --verify "${SINCE}^{commit}" >/dev/null 2>&1; then
  echo "::warning::Could not resolve git ref: ${SINCE}"
  write_defaults false true "invalid git ref: ${SINCE}"
  exit 0
fi

SINCE_SHA="$(git rev-parse "${SINCE}^{commit}")"
write_output "since" "$SINCE"
write_output "since-sha" "$SINCE_SHA"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "::warning::node/npm are not available. The Action installs Node; check the setup-node step."
  write_defaults false true "node/npm are not available"
  exit 0
fi

mkdir -p "$(dirname "$CONTEXTPACK_OUT")"
mkdir -p "$(dirname "$LIST_OUT")"

PKG="@shree_vitkar/contextpack@${CONTEXTPACK_VERSION}"
INSTALL_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/contextpack-cli-${CONTEXTPACK_VERSION}"
CLI_JS="${INSTALL_DIR}/node_modules/@shree_vitkar/contextpack/dist/index.js"

# Install the pinned npm package into a temp prefix (same idea as `npx -p`,
# but invoke node on dist/index.js so CI never depends on a contextpack PATH entry).
if [[ ! -f "$CLI_JS" ]]; then
  echo "Installing ${PKG} into ${INSTALL_DIR}"
  mkdir -p "$INSTALL_DIR"
  if ! npm install --prefix "$INSTALL_DIR" --no-fund --no-audit --loglevel=error "$PKG"; then
    echo "::warning::npm install ${PKG} failed."
    write_defaults false true "npm install ${PKG} failed"
    exit 0
  fi
fi

if [[ ! -f "$CLI_JS" ]]; then
  echo "::warning::Installed ${PKG} but dist/index.js is missing."
  write_defaults false true "contextpack dist/index.js missing after npm install"
  exit 0
fi

DIFF_ARGS=()
if [[ "$CONTEXTPACK_DIFF" == "true" ]]; then
  DIFF_ARGS+=(--diff)
fi

# Word-split extra args (documented). Avoid eval. noglob so --ignore *.md stays literal.
EXTRA_ARGS=()
if [[ -n "$CONTEXTPACK_EXTRA_ARGS" ]]; then
  set -o noglob
  # shellcheck disable=SC2206
  EXTRA_ARGS=($CONTEXTPACK_EXTRA_ARGS)
  set +o noglob
fi

echo "Packing ${CONTEXTPACK_PATH} since ${SINCE} (budget ${CONTEXTPACK_BUDGET}, format ${CONTEXTPACK_FORMAT}, diff=${CONTEXTPACK_DIFF})"

set +e
node "$CLI_JS" pack "$CONTEXTPACK_PATH" \
  --since "$SINCE" \
  "${DIFF_ARGS[@]}" \
  --budget "$CONTEXTPACK_BUDGET" \
  --format json \
  --list \
  --out "$LIST_OUT" \
  "${EXTRA_ARGS[@]}"
LIST_STATUS=$?

node "$CLI_JS" pack "$CONTEXTPACK_PATH" \
  --since "$SINCE" \
  "${DIFF_ARGS[@]}" \
  --budget "$CONTEXTPACK_BUDGET" \
  --format "$CONTEXTPACK_FORMAT" \
  --out "$CONTEXTPACK_OUT" \
  "${EXTRA_ARGS[@]}"
PACK_STATUS=$?
set -e

if [[ $LIST_STATUS -ne 0 && $PACK_STATUS -ne 0 ]]; then
  echo "::warning::contextpack pack failed (list exit ${LIST_STATUS}, pack exit ${PACK_STATUS}). Typical causes: not a git checkout, invalid --since ref, or missing git history."
  write_defaults false true "contextpack pack failed (exit ${PACK_STATUS})"
  exit 0
fi

FILES=0
TOKENS=0
PARSED=""
if [[ -f "$LIST_OUT" ]]; then
  # Node is available after setup-node; parse list JSON without requiring jq.
  PARSED="$(node -e '
    const fs = require("node:fs");
    const p = process.argv[1];
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const included = Number(data.summary?.included ?? 0);
    const partial = Number(data.summary?.partial ?? 0);
    const tokens = Number(data.summary?.totalTokens ?? 0);
    process.stdout.write(`${included + partial} ${tokens}`);
  ' "$LIST_OUT" 2>/dev/null || true)"
  if [[ -n "$PARSED" ]]; then
    FILES="${PARSED%% *}"
    TOKENS="${PARSED#* }"
  fi
fi

DIGEST_EXISTS=false
if [[ -f "$CONTEXTPACK_OUT" ]]; then
  DIGEST_EXISTS=true
fi

EMPTY=false
if [[ -n "$PARSED" && "$FILES" -eq 0 ]]; then
  EMPTY=true
  echo "Empty pack since ${SINCE}: no matching files (nothing changed, or everything was ignored)."
elif [[ -z "$PARSED" && "$PACK_STATUS" -ne 0 ]]; then
  EMPTY=true
fi

OK=true
if [[ $PACK_STATUS -ne 0 ]]; then
  OK=false
  echo "::warning::Digest pack failed (exit ${PACK_STATUS}); list preview may still be available."
fi

write_output "ok" "$OK"
write_output "empty" "$EMPTY"
write_output "error" "$([[ "$OK" == "true" ]] && echo "" || echo "contextpack pack failed (exit ${PACK_STATUS})")"
write_output "since" "$SINCE"
write_output "since-sha" "$SINCE_SHA"
write_output "files" "$FILES"
write_output "tokens" "$TOKENS"
write_output "budget" "$CONTEXTPACK_BUDGET"
write_output "digest-path" "$CONTEXTPACK_OUT"
write_output "digest-exists" "$DIGEST_EXISTS"
write_output "list-path" "$LIST_OUT"
write_output "pack-exit" "$PACK_STATUS"
write_output "list-exit" "$LIST_STATUS"

echo "contextpack: ${FILES} files · ~${TOKENS} tokens · budget ${CONTEXTPACK_BUDGET} · since ${SINCE}"
exit 0
