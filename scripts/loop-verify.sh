#!/usr/bin/env bash
# Verification gate for bmad-loop ([verify].commands). Mirrors CI (npm run check + npm test)
# plus the Convex tsc pass. Component tests (test:component) are browser-based and
# stay a local, manual step.
set -euo pipefail
cd "$(dirname "$0")/.."
export PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL:-https://placeholder.convex.cloud}"
npx tsc -p convex/tsconfig.json --noEmit
npm run check
npm test
