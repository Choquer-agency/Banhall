#!/usr/bin/env bash
# Run a bmad-loop spec end to end, riding out provider usage limits.
#
# bmad-loop pauses the run at an escalation when a session dies on a captured
# usage-limit line (.bmad-loop/profiles/claude.toml, env_fault_patterns). It has no
# model fallback and no timer, so this wrapper supplies the wait: sleep for the
# window to reset, re-arm the paused story with a fresh budget, resume. Any other
# pause (blocked story, contradiction, checkpoint) is left for a human.
#
# Usage:
#   scripts/loop.sh <spec-folder> [<target-branch>] [--push]
#   scripts/loop.sh _bmad-output/specs/spec-ai-engine-sprint-2-boundary sprint2-boundary --push
#
# Env: LOOP_WAIT_S (default 1800), LOOP_MAX_RESUMES (default 6)
set -uo pipefail
cd "$(dirname "$0")/.."
POLICY=".bmad-loop/policy.toml"
WAIT="${LOOP_WAIT_S:-1800}"
MAX="${LOOP_MAX_RESUMES:-6}"

SPEC="${1:-}"; BRANCH="${2:-}"; PUSH=0
[ -z "$SPEC" ] && { echo "usage: scripts/loop.sh <spec-folder> [<target-branch>] [--push]" >&2; exit 2; }
[ "$BRANCH" = "--push" ] && { BRANCH=""; PUSH=1; }
[ "${3:-}" = "--push" ] && PUSH=1
[ -f "$SPEC/stories.yaml" ] || { echo "no stories.yaml in $SPEC" >&2; exit 2; }
export PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL:-https://placeholder.convex.cloud}"

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
state() {  # <status> <paused_stage> <paused_reason>
  bmad-loop status --json "$1" 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('status') or '', d.get('paused_stage') or '', (d.get('paused_reason') or '').replace(chr(10),' ')[:200])" 2>/dev/null || echo unknown
}

# bmad-loop names run branches bmad-loop/<run-id>; a plain branch called `bmad-loop`
# makes every worktree open fail ("'refs/heads/bmad-loop' exists") and the run
# defers every story in seconds. Refuse to start on that footgun.
if git rev-parse --verify -q refs/heads/bmad-loop >/dev/null; then
  echo "a branch named 'bmad-loop' exists and shadows bmad-loop/<run-id>; rename it first: git branch -m bmad-loop archive/bmad-loop" >&2; exit 2
fi

if [ -n "$BRANCH" ]; then
  git rev-parse --verify -q "$BRANCH" >/dev/null || git branch "$BRANCH"
  sed -i '' "s|^target_branch = .*|target_branch = \"$BRANCH\"|" "$POLICY"
  trap 'sed -i "" "s|^target_branch = .*|target_branch = \"\"           # \"\" = the branch checked out at run start|" "$POLICY"' EXIT
fi

log "bmad-loop run --spec $SPEC${BRANCH:+ on $BRANCH}"
bmad-loop run --spec "$SPEC"; rc=$?
id="$(bmad-loop list 2>/dev/null | awk 'NR==2{print $4}')"
st="$(state "$id")"
n=0
while [ "$n" -lt "$MAX" ]; do
  case "$st" in
    *"environment fault"*|*"limit"*|*"rate"*|*"quota"*|*"transport"*) ;;
    *) break ;;
  esac
  n=$((n+1))
  log "run $id paused on a provider fault ($n/$MAX): $st"
  log "waiting ${WAIT}s for the usage window"
  sleep "$WAIT"
  bmad-loop resolve "$id" --no-interactive --resume || bmad-loop resume "$id"
  rc=$?
  st="$(state "$id")"
done

# A run that ends in seconds with every story deferred is an environment problem, not a verdict.
if ! rg -q '"kind": "session-start"' ".bmad-loop/runs/$id/journal.jsonl" 2>/dev/null; then
  log "run $id never started a session; first failure:"
  rg -m1 -o '"error": "[^"]{0,300}' ".bmad-loop/runs/$id/journal.jsonl" 2>/dev/null | head -1
  exit 1
fi

log "run $id: $st (rc $rc)"
if [ -n "$BRANCH" ] && [ "$PUSH" = 1 ]; then
  cur="$(git rev-parse --abbrev-ref HEAD)"
  if git push -u origin "$BRANCH"; then log "pushed $BRANCH"; else log "push failed for $BRANCH"; fi
  [ "$cur" != "$BRANCH" ] && git checkout -q "$cur"
fi
case "$st" in
  finished*) exit 0 ;;
  *) log "not finished; inspect with: bmad-loop status $id"; exit 1 ;;
esac
