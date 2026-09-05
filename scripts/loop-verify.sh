#!/usr/bin/env bash
# The one command that proves a change to this repo. CI runs this same script.
# Browser-free by default; VERIFY_COMPONENT=1 adds the component suite.
set -euo pipefail
cd "$(dirname "$0")/.."

VERIFY_COMPONENT="${VERIFY_COMPONENT:-0}"
if [ "$VERIFY_COMPONENT" = "1" ]; then
  STEP_TOTAL=9
else
  STEP_TOTAL=8
fi
STEP_INDEX=0

step() {
  local name="$1"
  shift
  STEP_INDEX=$((STEP_INDEX + 1))
  echo "[$STEP_INDEX/$STEP_TOTAL] $name"
  local started=$SECONDS
  local code=0
  "$@" || code=$?
  if [ "$code" -ne 0 ]; then
    echo "loop-verify: $name failed, exit $code"
    exit "$code"
  fi
  echo "ok $((SECONDS - started))s"
}

missing() {
  echo "loop-verify: required tool $1 not found. $2"
  exit 1
}

# set -e does not apply inside a function called from a || list, so every check
# below exits or returns explicitly.
preflight() {
  command -v node >/dev/null 2>&1 || missing node "Install Node 24 (see .nvmrc): https://nodejs.org/en/download"
  command -v npm >/dev/null 2>&1 || missing npm "npm ships with Node; install Node 24: https://nodejs.org/en/download"
  command -v pwsh >/dev/null 2>&1 || missing pwsh "Install PowerShell 7: https://learn.microsoft.com/powershell/scripting/install/installing-powershell"

  command -v git >/dev/null 2>&1 || missing git "Install Git: https://git-scm.com/downloads"

  local version major minor
  version="$(node -v)"
  version="${version#v}"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  # Vite 8 needs >=22.12 and vite-plugin-svelte rejects 23; .nvmrc pins 24.
  if [ "$major" -ge 24 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; }; then
    echo "  node v$version ok"
  else
    echo "loop-verify: node v$version is unsupported. Use Node 24 (see .nvmrc) or Node 22.12+."
    exit 1
  fi

  if [ -n "${PUBLIC_CONVEX_URL:-}" ]; then
    echo "  PUBLIC_CONVEX_URL from env"
  else
    export PUBLIC_CONVEX_URL="https://placeholder.convex.cloud"
    echo "  PUBLIC_CONVEX_URL from placeholder"
  fi
  if [ -n "${PUBLIC_CONVEX_SITE_URL:-}" ]; then
    echo "  PUBLIC_CONVEX_SITE_URL from env"
  else
    export PUBLIC_CONVEX_SITE_URL="https://placeholder.convex.site"
    echo "  PUBLIC_CONVEX_SITE_URL from placeholder"
  fi

  # A git worktree starts with no node_modules of its own. Bare specifiers still
  # resolve by walking up to the main checkout's node_modules, but literal
  # ../node_modules/... paths (convex/researchReviewMode.test.ts registers the
  # workflow/workpool component schemas that way) do not, so the gate must
  # install dependencies here before it can mean anything. It runs after the
  # tool checks so a cold checkout still fails on a missing tool first, and
  # before the Chromium check, which needs the playwright package.
  if [ -z "$(ls -A node_modules 2>/dev/null | grep -v '^\.' || true)" ]; then
    echo "  node_modules is empty, installing dependencies"
    npm ci --no-audit --no-fund || return $?
  fi

  if [ "$VERIFY_COMPONENT" = "1" ]; then
    # Exercise the same supported headless launch used by the component runner.
    # A regular Chromium executable alone does not prove headless-shell readiness.
    if ! node --input-type=module <<'NODE'
const watchdog = setTimeout(() => {
  console.error("Chromium readiness check timed out after 20 seconds");
  process.exit(1);
}, 20_000);
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, timeout: 15_000 });
  await browser.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
}
NODE
    then
      echo "loop-verify: Chromium headless launch failed. Run: npx playwright install chromium (on Linux: npx playwright install --with-deps chromium)"
      exit 1
    fi
    echo "  Chromium headless launch ok"
  fi
  return 0
}

step preflight preflight
step "convex typecheck" npx tsc -p convex/tsconfig.json --noEmit
step "svelte-check" npm run check
step "unit tests" npm test
step "test discovery guard" node scripts/check-test-discovery.mjs
step "production build" npm run build
# Client-uploader file-selection harnesses: uploader-lib.ps1 (Windows) and the
# scan/upload helpers in banhall-uploader.sh (Mac).
step "uploader harness (pwsh)" pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1
step "uploader harness (bash)" bash scripts/client-uploader/tests/run-tests.sh
if [ "$VERIFY_COMPONENT" = "1" ]; then
  step "component suite" npm run test:component
fi
