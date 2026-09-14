#!/usr/bin/env bash
# usage: run-mutation.sh <gap-dir> <mutation|pass> <test file>
set -u
WT=/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-validate-b
SP=/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall/74c117b1-0ee2-4aa9-a3bd-3095316a1935/scratchpad
gap=$1; name=$2; testfile=$3
out=$WT/.audit/pd-sweep-validation/test-hardening/$gap; mkdir -p "$out"
cd "$WT"
export PUBLIC_CONVEX_URL="https://placeholder.convex.cloud" PUBLIC_CONVEX_SITE_URL="https://placeholder.convex.site"
if [ -n "$(git diff -- 'convex/*.ts' ':!*.test.ts')" ]; then echo "source not clean before $name"; exit 2; fi
if [ "$name" = pass ]; then log=$out/pass.raw.log; else
  src=$(python3 "$SP/mutate.py" "$name") || exit 2
  git diff -- "$src" > "$out/mutation-$name.diff"
  log=$out/mutation-$name.raw.log
fi
{
  echo "# gap=$gap run=$name date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# HEAD=$(git rev-parse HEAD) node=$(node -v)"
  echo "# PUBLIC_CONVEX_URL=$PUBLIC_CONVEX_URL PUBLIC_CONVEX_SITE_URL=$PUBLIC_CONVEX_SITE_URL"
  echo "# sha256 $(shasum -a 256 "$testfile")"
  echo "# source diff (mutation) stat:"; git diff --stat -- 'convex/*.ts' ':!*.test.ts'
  echo "# cmd: npx vitest run --config vitest.config.ts --reporter=verbose $testfile"
} > "$log"
npx vitest run --config vitest.config.ts --reporter=verbose "$testfile" >> "$log" 2>&1
code=$?
echo "EXIT_CODE=$code" >> "$log"
if [ "$name" != pass ]; then git checkout -- "$src"; fi
rest=$(git diff -- 'convex/*.ts' ':!*.test.ts')
echo "# restored source diff empty: $([ -z "$rest" ] && echo yes || echo NO)" >> "$log"
echo "$name exit=$code restored=$([ -z "$rest" ] && echo yes || echo NO)"
grep -E "^ +(×|✗|✓) " "$log" | grep -E "guards within scoped reach|DW-112" | sed 's/^/   /'
