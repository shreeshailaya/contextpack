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

# Collapse npm/build logs into a single GitHub-output-safe line.
summarize_log() {
  local logf="$1"
  local snippet=""
  [[ -f "$logf" ]] || return 0
  snippet="$(grep -iE 'npm error|notarget|ETARGET|E404|ERR!|error TS' "$logf" 2>/dev/null | tail -n 6 || true)"
  if [[ -z "$snippet" ]]; then
    snippet="$(tail -n 6 "$logf" 2>/dev/null || true)"
  fi
  snippet="$(printf '%s' "$snippet" | tr '\n\r' '  ' | tr '"' "'" | tr '`$\\' '    ')"
  snippet="${snippet:0:400}"
  printf '%s' "$snippet"
}

npm_log_missing_version() {
  grep -qiE 'ETARGET|E404|notarget|No matching version found|404 Not Found' "$1" 2>/dev/null
}

# CONTEXTPACK_NPM_ATTEMPTS / CONTEXTPACK_NPM_RETRY_SLEEP are test hooks (defaults: 3 / 2).
npm_install_spec() {
  local spec="$1"
  local dest="$2"
  local logf="$3"
  local attempts="${CONTEXTPACK_NPM_ATTEMPTS:-3}"
  local delay="${CONTEXTPACK_NPM_RETRY_SLEEP:-2}"
  local i
  if ! [[ "$attempts" =~ ^[1-9][0-9]*$ ]]; then
    attempts=3
  fi
  if ! [[ "$delay" =~ ^[0-9]+$ ]]; then
    delay=2
  fi
  mkdir -p "$dest"
  i=1
  while [[ "$i" -le "$attempts" ]]; do
    echo "Installing ${spec} into ${dest} (attempt ${i}/${attempts})"
    if npm install --prefix "$dest" --no-fund --no-audit --loglevel=error "$spec" >"$logf" 2>&1; then
      return 0
    fi
    echo "npm install ${spec} failed (attempt ${i}/${attempts})"
    cat "$logf" || true
    if [[ "$i" -lt "$attempts" && "$delay" -gt 0 ]]; then
      sleep "$delay"
      delay=$((delay * 2))
    fi
    i=$((i + 1))
  done
  return 1
}

checkout_is_contextpack() {
  local pkg_json="${WORK_ROOT}/package.json"
  [[ -f "$pkg_json" ]] || return 1
  node -e '
    const fs = require("node:fs");
    try {
      const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.exit(pkg && pkg.name === "@shree_vitkar/contextpack" ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$pkg_json"
}

# Prefer the checked-out CLI on this repo so dogfood PRs do not wait for npm publish.
try_local_cli() {
  local local_js="${WORK_ROOT}/dist/index.js"
  local logf
  local tmpdir
  if [[ -f "$local_js" ]]; then
    echo "Using local contextpack CLI at ${local_js} (checkout is @shree_vitkar/contextpack)."
    CLI_JS="$local_js"
    return 0
  fi

  echo "Checkout is @shree_vitkar/contextpack; building local CLI (pinned npm version may not be published yet)."
  tmpdir="${TMPDIR:-/tmp}"
  mkdir -p "$tmpdir"
  logf="$(mktemp "${tmpdir}/contextpack-local-build.XXXXXX")"
  {
    if [[ ! -d "${WORK_ROOT}/node_modules" ]]; then
      if [[ -f "${WORK_ROOT}/package-lock.json" ]]; then
        (cd "$WORK_ROOT" && npm ci --no-fund --no-audit --loglevel=error)
      else
        (cd "$WORK_ROOT" && npm install --no-fund --no-audit --loglevel=error)
      fi
    fi && (cd "$WORK_ROOT" && npm run build)
  } >"$logf" 2>&1
  if [[ ! -f "$local_js" ]]; then
    echo "::warning::Local contextpack CLI build failed."
    cat "$logf" || true
    LOCAL_BUILD_ERROR="$(summarize_log "$logf")"
    rm -f "$logf"
    return 1
  fi
  rm -f "$logf"
  echo "Using local contextpack CLI at ${local_js}"
  CLI_JS="$local_js"
  return 0
}

install_cli_from_npm() {
  local spec="$1"
  local dest="$2"
  local logf="${dest}/npm-install.log"
  local latest=""
  local fallback_dest=""

  mkdir -p "$dest"
  if npm_install_spec "$spec" "$dest" "$logf"; then
    CLI_JS="${dest}/node_modules/@shree_vitkar/contextpack/dist/index.js"
    return 0
  fi

  if ! npm_log_missing_version "$logf"; then
    NPM_INSTALL_ERROR="$(summarize_log "$logf")"
    return 1
  fi

  echo "Pinned ${CONTEXTPACK_VERSION} is not on npm; looking up latest published version."
  latest="$(npm view @shree_vitkar/contextpack version --silent 2>/dev/null || true)"
  if [[ -z "$latest" || "$latest" == "$CONTEXTPACK_VERSION" ]]; then
    NPM_INSTALL_ERROR="$(summarize_log "$logf")"
    return 1
  fi

  echo "Falling back to @shree_vitkar/contextpack@${latest}"
  fallback_dest="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/contextpack-cli-${latest}"
  logf="${fallback_dest}/npm-install.log"
  mkdir -p "$fallback_dest"
  if npm_install_spec "@shree_vitkar/contextpack@${latest}" "$fallback_dest" "$logf"; then
    CLI_JS="${fallback_dest}/node_modules/@shree_vitkar/contextpack/dist/index.js"
    return 0
  fi
  NPM_INSTALL_ERROR="$(summarize_log "$logf")"
  return 1
}

LIST_OUT="${CONTEXTPACK_LIST_OUT:-contextpack-pr-list.json}"
CONTEXTPACK_OUT="${CONTEXTPACK_OUT:-contextpack-pr.md}"
CONTEXTPACK_BUDGET="${CONTEXTPACK_BUDGET:-12000}"
CONTEXTPACK_PATH="${CONTEXTPACK_PATH:-.}"
CONTEXTPACK_FORMAT="${CONTEXTPACK_FORMAT:-md}"
CONTEXTPACK_VERSION="${CONTEXTPACK_VERSION:-0.1.15}"
CONTEXTPACK_DIFF="${CONTEXTPACK_DIFF:-true}"
CONTEXTPACK_EXTRA_ARGS="${CONTEXTPACK_EXTRA_ARGS:-}"
WORK_ROOT="$(cd "${GITHUB_WORKSPACE:-.}" && pwd)"
CLI_JS=""
LOCAL_BUILD_ERROR=""
NPM_INSTALL_ERROR=""

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

if checkout_is_contextpack; then
  try_local_cli || true
fi

if [[ ! -f "$CLI_JS" ]]; then
  INSTALL_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/contextpack-cli-${CONTEXTPACK_VERSION}"
  if ! install_cli_from_npm "$PKG" "$INSTALL_DIR"; then
    err="npm install ${PKG} failed"
    if [[ -n "${NPM_INSTALL_ERROR:-}" ]]; then
      err="${err}: ${NPM_INSTALL_ERROR}"
    fi
    if [[ -n "${LOCAL_BUILD_ERROR:-}" ]]; then
      err="${err} (local CLI build also failed: ${LOCAL_BUILD_ERROR})"
    fi
    echo "::warning::${err}"
    write_defaults false true "$err"
    exit 0
  fi
fi

if [[ ! -f "$CLI_JS" ]]; then
  echo "::warning::Resolved contextpack CLI but dist/index.js is missing."
  write_defaults false true "contextpack dist/index.js missing after install"
  exit 0
fi

# CLI 0.1.11+ treats a non-TTY stdin as --paths-from -. GitHub Actions always
# has a non-TTY empty stdin, which would pack nothing. Write the --since file
# list and pass it explicitly so auto-stdin does not win.
PATHS_FROM="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/contextpack-pr-paths.txt"
mkdir -p "$(dirname "$PATHS_FROM")"
PACK_ROOT="$(cd "$CONTEXTPACK_PATH" && pwd)"
node -e '
  const { spawnSync } = require("node:child_process");
  const fs = require("node:fs");
  const path = require("node:path");
  const packRoot = path.resolve(process.argv[1]);
  const since = process.argv[2];
  const outFile = process.argv[3];
  const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).stdout.trim();
  const names = (args) => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
  };
  const files = [
    ...names(["diff", "--name-only", since, "--", packRoot]),
    ...names(["ls-files", "--others", "--exclude-standard", "--", packRoot]),
  ];
  const seen = new Set();
  const lines = [];
  for (const file of files) {
    const abs = path.resolve(gitRoot, file);
    const rel = path.relative(packRoot, abs).split(path.sep).join("/");
    if (!rel || rel === "." || rel.startsWith("../") || rel === "..") continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    lines.push(rel);
  }
  fs.writeFileSync(outFile, lines.length ? `${lines.join("\n")}\n` : "");
' "$PACK_ROOT" "$SINCE" "$PATHS_FROM" || {
  echo "::warning::Could not list files changed since ${SINCE}; writing an empty --paths-from list."
  : >"$PATHS_FROM"
}

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
  --paths-from "$PATHS_FROM" \
  "${DIFF_ARGS[@]}" \
  --budget "$CONTEXTPACK_BUDGET" \
  --format json \
  --list \
  --out "$LIST_OUT" \
  "${EXTRA_ARGS[@]}"
LIST_STATUS=$?

node "$CLI_JS" pack "$CONTEXTPACK_PATH" \
  --since "$SINCE" \
  --paths-from "$PATHS_FROM" \
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
