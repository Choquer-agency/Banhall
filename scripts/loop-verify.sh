#!/usr/bin/env bash
# Verification gate for bmad-loop ([verify].commands). Mirrors CI (npm run check + npm test)
# plus the Convex tsc pass. Component tests (test:component) are browser-based and
# stay a local, manual step.
set -euo pipefail
cd "$(dirname "$0")/.."
export PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL:-https://placeholder.convex.cloud}"

# A git worktree starts with no node_modules of its own. Bare specifiers still
# resolve by walking up to the main checkout's node_modules, but literal
# ../node_modules/... paths (convex/researchReviewMode.test.ts registers the
# workflow/workpool component schemas that way) do not, so the gate must install
# dependencies here before it can mean anything.
if [ -z "$(ls -A node_modules 2>/dev/null | grep -v '^\.' || true)" ]; then
  echo "loop-verify: node_modules is empty, installing dependencies"
  npm ci --no-audit --no-fund
fi

npx tsc -p convex/tsconfig.json --noEmit
npm run check
npm test
# Client-uploader file-selection harnesses: uploader-lib.ps1 (Windows) and the
# scan/upload helpers in banhall-uploader.sh (Mac).
pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1
bash scripts/client-uploader/tests/run-tests.sh
