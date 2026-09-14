#!/bin/bash
# usage: run.sh <outdir> <label> <files...>
set -u
WT=/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-validate-b
OUT=$1; LABEL=$2; shift 2
mkdir -p "$OUT"
cd "$WT"
export PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL:-https://placeholder.convex.cloud}"
export PUBLIC_CONVEX_SITE_URL="${PUBLIC_CONVEX_SITE_URL:-https://placeholder.convex.site}"
{
  echo "# label=$LABEL"
  echo "# HEAD=$(git rev-parse HEAD)"
  echo "# git status --short:"; git status --short
  echo "# date=$(date -u +%FT%TZ) node=$(node -v)"
  echo "# env PUBLIC_CONVEX_URL=$PUBLIC_CONVEX_URL PUBLIC_CONVEX_SITE_URL=$PUBLIC_CONVEX_SITE_URL"
  echo "# cmd: npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=$OUT/$LABEL.json $*"
} > "$OUT/$LABEL.raw.log"
npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json="$OUT/$LABEL.json" "$@" >> "$OUT/$LABEL.raw.log" 2>&1
rc=$?
echo "# exit=$rc" >> "$OUT/$LABEL.raw.log"
echo "exit=$rc"
node -e '
const r=require(process.argv[1]);
console.log(`passed=${r.numPassedTests} failed=${r.numFailedTests} total=${r.numTotalTests} suitesFailed=${r.numFailedTestSuites}`);
for(const f of r.testResults){ if(f.status!=="passed"&&f.assertionResults.length===0) console.log("FILE-FAIL",f.name,(f.message||"").slice(0,400)); for(const a of f.assertionResults) if(a.status!=="passed") console.log(a.status.toUpperCase(),"::",a.fullName);}
' "$OUT/$LABEL.json" | tee "$OUT/$LABEL.summary.txt"
