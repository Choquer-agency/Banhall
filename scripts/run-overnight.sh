#!/usr/bin/env bash
# Unattended overnight pipeline for Banhall.
#
#   1. factory: re-drive the escalated tickets (already implemented, need review/QA),
#      then any remaining todo tickets. Merges land on main. Push main.
#   2. bmad-loop: sprint-2 boundary stories on branch overnight/sprint2-boundary.
#   3. bmad-loop: sprint-2 learn-chat stories on branch overnight/sprint2-learn-chat.
#   Each branch is pushed when its run reaches a terminal state, even if some
#   stories deferred, so the morning review always has something to look at.
#
# Usage:  scripts/run-overnight.sh [--skip-factory] [--skip-boundary] [--skip-learn]
# Logs:   .bmad-loop/overnight/<stamp>/
# Stop:   factory stop; bmad-loop stop <run_id>
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/.bmad-loop/overnight/$STAMP"
mkdir -p "$OUT"
LOG="$OUT/overnight.log"
SUMMARY="$OUT/SUMMARY.md"
POLICY="$ROOT/.bmad-loop/policy.toml"

SKIP_FACTORY=0; SKIP_BOUNDARY=0; SKIP_LEARN=0
for a in "$@"; do
  case "$a" in
    --skip-factory) SKIP_FACTORY=1 ;;
    --skip-boundary) SKIP_BOUNDARY=1 ;;
    --skip-learn) SKIP_LEARN=1 ;;
    *) echo "unknown flag $a" >&2; exit 2 ;;
  esac
done

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }
note() { printf '%s\n' "$*" >> "$SUMMARY"; }
notify() {
  osascript -e "display notification \"$2\" with title \"Banhall overnight\" subtitle \"$1\"" >/dev/null 2>&1 || true
}
export PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL:-https://placeholder.convex.cloud}"

printf '# Overnight run %s\n\n' "$STAMP" > "$SUMMARY"
log "start; base $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# ---------- guards ----------
if [ -n "$(git status --porcelain --untracked-files=no -- . ':(exclude)scripts/run-overnight.sh')" ]; then
  log "working tree dirty; commit first"; exit 1
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  log "no origin remote"; exit 1
fi

# ---------- helpers ----------
push_branch() {
  local br="$1"
  if git push -u origin "$br" >>"$LOG" 2>&1; then
    log "pushed $br"; note "- pushed \`$br\` ($(git rev-parse --short "$br"))"
  else
    log "push failed for $br (see log)"; note "- push FAILED for \`$br\`"
  fi
}

# Wait for the detached factory engine to reach a terminal state.
wait_factory() {
  local id="$1" st
  while :; do
    st="$(python3 -c "import json;print(json.load(open('.factory/runs/$id/state.json'))['status'])" 2>/dev/null || echo unknown)"
    case "$st" in running|"") sleep 60 ;; *) echo "$st"; return ;; esac
  done
}

# Quota pauses: bmad-loop classifies a captured usage-limit line as an environment
# fault (see .bmad-loop/profiles/claude.toml) and pauses the run with its budget
# intact. Wait for the window to reset, then resume. Bounded so a dead provider
# cannot hold the night hostage.
RESUME_WAIT_S="${RESUME_WAIT_S:-1800}"
RESUME_MAX="${RESUME_MAX:-6}"

loop_state() {  # prints: <status> <paused_stage> <paused_reason>
  bmad-loop status --json "$1" 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('status') or '', d.get('paused_stage') or '', (d.get('paused_reason') or '').replace(chr(10),' ')[:160])" 2>/dev/null || echo "unknown"
}

# bmad-loop runs in the foreground and returns when the run finishes, pauses or stops.
run_loop() {
  local spec="$1" branch="$2" label="$3"
  log "bmad-loop $label on $branch"
  git checkout -q main
  git branch -f "$branch" main
  # target_branch is read from policy.toml; set it for this run only.
  sed -i '' "s|^target_branch = .*|target_branch = \"$branch\"|" "$POLICY"
  bmad-loop run --spec "$spec" >>"$OUT/$label.log" 2>&1
  local rc=$?
  local id; id="$(bmad-loop list 2>/dev/null | awk 'NR==2{print $4}')"
  local st; st="$(loop_state "$id")"
  local tries=0
  while [ "$tries" -lt "$RESUME_MAX" ]; do
    case "$st" in
      *"environment fault"*|*"limit"*|*"rate"*|*"quota"*|*"transport"*) ;;
      *) break ;;
    esac
    tries=$((tries+1))
    log "$label paused on provider fault (try $tries/$RESUME_MAX): $st; sleeping ${RESUME_WAIT_S}s"
    note "- pause $tries: $st"
    sleep "$RESUME_WAIT_S"
    # An environment-fault pause is an escalation: re-arm the story with a fresh
    # budget and resume without the interactive resolve agent. Plain `resume`
    # refuses escalation pauses.
    bmad-loop resolve "$id" --no-interactive --resume >>"$OUT/$label.log" 2>&1 \
      || bmad-loop resume "$id" >>"$OUT/$label.log" 2>&1
    rc=$?
    st="$(loop_state "$id")"
  done
  log "$label finished rc=$rc run=$id state=$st"
  note "## $label"
  note "- run \`$id\`, state: $st (rc $rc)"
  bmad-loop status "$id" >>"$OUT/$label.status.txt" 2>&1 || true
  git checkout -q main
  if [ "$(git rev-parse "$branch")" != "$(git rev-parse main)" ]; then
    push_branch "$branch"
    note "- commits: $(git log --oneline main.."$branch" | wc -l | tr -d ' ')"
    git log --oneline main.."$branch" | sed 's/^/    /' >> "$SUMMARY"
  else
    note "- no commits landed on $branch"
  fi
  note ""
  notify "$label" "$st"
}

# ---------- 1. factory ----------
if [ "$SKIP_FACTORY" = 0 ]; then
  log "factory: re-driving escalated tickets"
  note "## factory"
  # Adopt a factory run already in flight (relaunch after a wrapper restart).
  latest="$(ls -t .factory/runs 2>/dev/null | head -1)"
  if [ -n "$latest" ] && [ "$(python3 -c "import json;print(json.load(open('.factory/runs/$latest/state.json'))['status'])" 2>/dev/null)" = "running" ]; then
    log "adopting in-flight factory run $latest"
    st="$(wait_factory "$latest")"
    log "$latest -> $st"; note "- adopted $latest: $st"
  fi
  # Re-drive escalated tickets one by one (they already carry implementations).
  for t in $(factory tickets 2>/dev/null | awk '$2=="escalated"{print $1}'); do
    log "factory run --ticket $t"
    factory run --ticket "$t" >>"$OUT/factory.log" 2>&1 || { log "factory refused $t"; note "- $t: refused to start (see factory.log)"; continue; }
    id="$(ls -t .factory/runs | head -1)"
    st="$(wait_factory "$id")"
    log "$t -> $st"; note "- $t: $st (run $id)"
  done
  # Then everything still todo, in dependency order, with the engine's own scheduler.
  if factory tickets 2>/dev/null | awk '$2=="todo"{f=1} END{exit !f}'; then
    log "factory run --all"
    if factory run --all >>"$OUT/factory.log" 2>&1; then
      id="$(ls -t .factory/runs | head -1)"
      st="$(wait_factory "$id")"
      log "factory --all -> $st"; note "- --all: $st (run $id)"
    else
      log "factory --all refused"; note "- --all: refused (see factory.log)"
    fi
  fi
  factory tickets >>"$OUT/factory.tickets.txt" 2>&1 || true
  git checkout -q main
  push_branch main
  note ""
  notify "factory" "done; main pushed"
fi

# ---------- 2/3. bmad-loop sprints ----------
[ "$SKIP_BOUNDARY" = 0 ] && run_loop "_bmad-output/specs/spec-ai-engine-sprint-2-boundary" "overnight/sprint2-boundary" "boundary"
[ "$SKIP_LEARN" = 0 ] && run_loop "_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat" "overnight/sprint2-learn-chat" "learn-chat"

# restore policy target so a manual run tomorrow does not land on a stale branch
sed -i '' 's|^target_branch = .*|target_branch = ""           # "" = the branch checked out at run start|' "$POLICY"
git checkout -q main

log "all done"
note "Morning review: \`git log main..overnight/sprint2-boundary\`, \`git log main..overnight/sprint2-learn-chat\`, then \`factory ship\` or open PRs."
notify "overnight" "complete; see $OUT/SUMMARY.md"
cat "$SUMMARY"
