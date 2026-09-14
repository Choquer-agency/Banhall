#!/usr/bin/env bash
# usage: run-phase.sh <bundle-key> <phase-name> <checkout-ref> <overlay-ref-or-""> <test files...>
set -u
WT=/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-validate-a
EV=/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall/74c117b1-0ee2-4aa9-a3bd-3095316a1935/scratchpad/evidence
key=$1; phase=$2; ref=$3; overlay=$4; shift 4
out=$EV/$key; mkdir -p "$out"
log=$out/$phase.raw.log
cd "$WT"
git reset -q --hard && git checkout -q --detach "$ref"
if [ -n "$overlay" ]; then git checkout "$overlay" -- "$@"; fi
export PUBLIC_CONVEX_URL="https://placeholder.convex.cloud" PUBLIC_CONVEX_SITE_URL="https://placeholder.convex.site"
{
  echo "# bundle=$key phase=$phase"
  echo "# date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# HEAD=$(git rev-parse HEAD) overlay=${overlay:-none}"
  echo "# node=$(node -v) PUBLIC_CONVEX_URL=$PUBLIC_CONVEX_URL PUBLIC_CONVEX_SITE_URL=$PUBLIC_CONVEX_SITE_URL"
  for f in "$@"; do echo "# sha256 $(shasum -a 256 "$f")"; done
  echo "# git status:"; git status --short
  echo "# cmd: npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=$out/$phase.json $*"
} > "$log"
npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json="$out/$phase.json" "$@" >> "$log" 2>&1
code=$?
echo "EXIT_CODE=$code" >> "$log"
git reset -q --hard && git checkout -q --detach e22a4b4
echo "$phase exit $code"
