#!/bin/bash
# Banhall document uploader — macOS/Linux version (Path B — BNH-17).
#
# Same behavior as banhall-uploader.ps1: walks your OneDrive "Applications"
# folder READ-ONLY (nothing modified, moved, or deleted; symlinks never
# followed) and uploads copies of past PDs / transcripts to the Banhall app's
# review queue. Nothing enters the AI knowledge base until an admin approves
# each file inside the app.
#
# Folder arguments win: `bash banhall-uploader.sh <folder> [<folder>…]`
# scans exactly those folders (drag folders into the Terminal window to paste
# their paths). Uploaded paths are rebuilt relative to the "Applications"
# folder in each argument folder's own location (full path if none), so
# Client/Fiscal year context — and dedupe against full-folder runs — is
# preserved no matter which subfolder is passed. Without arguments it uses
# the remembered/auto-detected root as before.
#
# Uses only tools that ship with macOS: bash, find, shasum, curl, stat.
# Configuration comes from uploader-config.json next to this script.
# The only file written is upload-log.txt next to this script.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/uploader-config.json"
LOG="$SCRIPT_DIR/upload-log.txt"

pause_exit() { echo ""; read -r -p "Press Enter to close " _; exit "${1:-0}"; }

if [ ! -f "$CONFIG" ]; then
  echo "Missing uploader-config.json next to this script."
  pause_exit 1
fi

# Our own controlled config format — simple key extraction is fine here.
json_get() {
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG" | head -1
}
APP_URL="$(json_get url)"; APP_URL="${APP_URL%/}"
KEY="$(json_get key)"
ROOT="$(json_get root)"

case "$APP_URL" in
  https://*) : ;;
  *) echo "Config error: url must start with https://"; pause_exit 1 ;;
esac
if [ "${#KEY}" -lt 32 ]; then
  echo "Config error: key looks wrong (too short)."
  pause_exit 1
fi

# Remember the chosen folder for next time (config is our own format).
# Backslashes and quotes in the path are JSON-escaped so a re-read round-trips.
save_root() {
  local esc
  esc="$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '{\n  "url": "%s",\n  "key": "%s",\n  "root": "%s"\n}\n' \
    "$APP_URL" "$KEY" "$esc" > "$CONFIG"
}

# Native macOS folder chooser; falls back to typing a path when no GUI.
pick_folder() {
  local start="$1" picked=""
  picked="$(osascript -e "POSIX path of (choose folder with prompt \"Choose the folder that holds your client documents\" default location POSIX file \"$start\")" 2>/dev/null || true)"
  if [ -n "$picked" ]; then
    echo "${picked%/}"
    return
  fi
  read -r -p "Type the full path of the folder to scan: " picked
  echo "${picked%/}"
}

# Folders to scan.
#
# Arguments win (not persisted — an argument-less run later still uses the
# remembered root). Otherwise: config "root" wins; otherwise auto-detect the
# synced OneDrive folder (locations differ per machine: ~/OneDrive,
# "OneDrive - Org", ~/Library/CloudStorage/OneDrive-…), look for an
# "Applications" folder up to 3 levels deep, confirm the guess with the user,
# and let them pick the real folder if the guess is wrong — we can't assume
# every machine's layout.
ROOTS=()
DROPPED_MODE=0
if [ "$#" -gt 0 ]; then
  DROPPED_MODE=1
  for p in "$@"; do
    if [ -d "$p" ]; then
      ROOTS+=("$(cd "$p" && pwd)")
    elif [ -e "$p" ]; then
      echo "  ! skipped (pass folders, not single files): $p"
    else
      echo "  ! skipped (not found): $p"
    fi
  done
  if [ "${#ROOTS[@]}" -eq 0 ]; then
    echo "None of the given paths were folders."
    pause_exit 1
  fi
else
  FOUND_ONEDRIVE=""
  # A remembered folder is a default, not a lock-in: confirm it each run and
  # offer the chooser again (client feedback Aug 18).
  if [ -n "$ROOT" ] && [ -d "$ROOT" ]; then
    echo "Last time you scanned:"
    echo "  $ROOT"
    read -r -p "Scan this folder again? (y = yes / c = choose a different folder) " AGAIN || AGAIN=""
    case "$AGAIN" in
      y|Y|yes|YES) : ;;
      *) ROOT="$(pick_folder "$ROOT")" ;;
    esac
  elif [ -n "$ROOT" ]; then
    echo "The remembered folder no longer exists: $ROOT"
    ROOT=""
  fi
  if [ -z "$ROOT" ]; then
    GUESS=""
    for od in "$HOME/Library/CloudStorage"/OneDrive* "$HOME"/OneDrive*; do
      [ -d "$od" ] || continue
      FOUND_ONEDRIVE="$od"
      hit="$(find "$od" -maxdepth 3 -type d -iname "Applications" 2>/dev/null | head -1)"
      if [ -n "$hit" ]; then GUESS="$hit"; break; fi
    done

    if [ -n "$GUESS" ]; then
      echo "Found a likely documents folder:"
      echo "  $GUESS"
      read -r -p "Scan this folder? (y = yes / c = choose a different folder) " PICK
      case "$PICK" in
        y|Y|yes|YES) ROOT="$GUESS" ;;
        *) ROOT="$(pick_folder "$GUESS")" ;;
      esac
    elif [ -n "$FOUND_ONEDRIVE" ]; then
      echo "Found your OneDrive at: $FOUND_ONEDRIVE"
      echo "Now choose the folder inside it that holds your client documents."
      ROOT="$(pick_folder "$FOUND_ONEDRIVE")"
    else
      echo "Could not find a OneDrive folder on this computer."
      echo "Choose the folder that holds your client documents."
      ROOT="$(pick_folder "$HOME")"
    fi
  fi
  if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
    echo "That folder does not exist: $ROOT"
    pause_exit 1
  fi
  ROOT="$(cd "$ROOT" && pwd)"
  # Persist so the next run scans the same folder without asking again.
  save_root "$ROOT"
  ROOTS=("$ROOT")
fi

MAX_BYTES=$((15 * 1024 * 1024))
TEST_CAP=100

echo ""
echo "Banhall document uploader"
for r in "${ROOTS[@]}"; do
  echo "  Scanning (read-only): $r"
done
echo "  Uploading to:         $APP_URL/ingestion/upload"
echo ""

# The server derives clientName/fiscalYear from the first two path segments
# (`Client/Fiscal year/…`) and dedupes by the full relative path. An argument
# folder therefore can't just contribute its leaf name — that would classify
# every file under a client called "PDs" and collide across clients. Rebuild
# the ancestry instead: anchor at the LAST "Applications" segment of the
# folder's own absolute path (the corpus root convention); if there is none,
# fall back to the full path so rels stay unique and stable.
drop_prefix() {
  local abs="${1#/}" out="" seg last=-1 i=0 n=0
  local segs=()
  local IFS='/'
  for seg in $abs; do
    [ -n "$seg" ] || continue
    segs[$n]="$seg"
    n=$((n + 1))
  done
  for ((i = 0; i < n; i++)); do
    case "$(printf '%s' "${segs[$i]}" | tr '[:upper:]' '[:lower:]')" in
      applications) last=$i ;;
    esac
  done
  for ((i = last + 1; i < n; i++)); do
    out="$out${segs[$i]}/"
  done
  printf '%s' "$out"
}

# Collect candidate files across every root as "rel<TAB>fullpath" lines.
# find does not follow symlinks by default; -type f also excludes them.
# sort -u drops duplicate rels from nested/overlapping argument folders.
FILELIST="$(mktemp)"
trap 'rm -f "$FILELIST"' EXIT
for r in "${ROOTS[@]}"; do
  PREFIX=""
  if [ "$DROPPED_MODE" -eq 1 ]; then PREFIX="$(drop_prefix "$r")"; fi
  find "$r" -type f \
    \( -iname '*.docx' -o -iname '*.doc' -o -iname '*.pdf' -o -iname '*.txt' -o -iname '*.vtt' \) \
    ! -name '~$*' ! -name '.*' -print 2>/dev/null | while IFS= read -r f; do
      printf '%s\t%s\n' "$PREFIX${f#"$r"/}" "$f"
    done
done | sort -u -t "$(printf '\t')" -k1,1 > "$FILELIST"
COUNT="$(wc -l < "$FILELIST" | tr -d ' ')"

echo "Found $COUNT document(s) (.docx/.doc/.pdf/.txt/.vtt)."
if [ "$COUNT" -eq 0 ]; then rm -f "$FILELIST"; pause_exit 0; fi

# Big first runs: offer a small test batch so the review queue can be checked
# before committing to a full historical ingestion. Re-running later uploads
# the rest — already-sent files are skipped by the server.
if [ "$COUNT" -gt "$TEST_CAP" ]; then
  read -r -p "Upload ALL $COUNT, or just the first $TEST_CAP as a TEST batch? (a = all / t = test $TEST_CAP / n = cancel) " MODE || MODE=""
  # Only an explicit answer proceeds — Enter, typos, and closed stdin all
  # cancel. The dangerous option (everything) must never be the default.
  case "$MODE" in
    a|A|all|ALL) : ;;
    t|T|test|TEST)
      CAPPED="$(mktemp)"
      head -n "$TEST_CAP" "$FILELIST" > "$CAPPED"
      mv "$CAPPED" "$FILELIST"
      echo "Test mode: uploading the first $TEST_CAP documents. Run again later and choose 'a' for the rest."
      ;;
    *) echo "Cancelled. Nothing was uploaded."; pause_exit 0 ;;
  esac
else
  read -r -p "Upload them to the Banhall review queue now? (y/n) " ANSWER
  case "$ANSWER" in
    y|Y|yes|YES) : ;;
    *) echo "Cancelled. Nothing was uploaded."; rm -f "$FILELIST"; pause_exit 0 ;;
  esac
fi

file_size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
file_mtime_ms() {
  local s
  s="$(stat -f%m "$1" 2>/dev/null || stat -c%Y "$1")"
  echo "$((s * 1000))"
}
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}
urlencode() {
  # LC_ALL=C makes the loop byte-wise, so accented folder names (UTF-8
  # multibyte) percent-encode correctly instead of as bare codepoints.
  local LC_ALL=C s="$1" out="" c i
  for (( i=0; i<${#s}; i++ )); do
    c="${s:$i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out="$out$c" ;;
      # & 255 guards against printf sign-extending bytes >127 (UTF-8 tails).
      *) out="$out$(printf '%%%02X' "$(( $(printf '%d' "'$c") & 255 ))")" ;;
    esac
  done
  printf '%s\n' "$out"
}

STAGED=0; SKIPPED=0; TOO_LARGE=0; FAILED=0
: > "$LOG"

while IFS=$'\t' read -r REL FILE; do
  SIZE="$(file_size "$FILE")"
  if [ "$SIZE" -gt "$MAX_BYTES" ]; then
    TOO_LARGE=$((TOO_LARGE + 1))
    echo "  - too large   $REL"
    echo "TOO_LARGE	$REL" >> "$LOG"
    continue
  fi
  HASH="$(sha256_of "$FILE")"
  MTIME="$(file_mtime_ms "$FILE")"
  URI="$APP_URL/ingestion/upload?path=$(urlencode "$REL")&hash=$HASH&mtime=$MTIME"

  OK=0
  for ATTEMPT in 0 1 2 3; do
    BODY="$(mktemp)"
    # No `|| echo` fallback: on connection failure curl's -w already emits
    # 000 AND exits non-zero, so appending another 000 would corrupt STATUS.
    STATUS="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$URI" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$FILE" 2>/dev/null)" || STATUS="000"
    case "$STATUS" in *[!0-9]*|"") STATUS="000" ;; esac
    if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
      # Key revoked/wrong: every remaining file would fail identically —
      # stop now with a message a non-technical user can act on.
      echo ""
      echo "The access key in uploader-config.json is not valid (HTTP $STATUS)."
      echo "It may have been revoked. Contact the dev team for a new kit."
      echo "ABORTED	access key rejected (HTTP $STATUS)" >> "$LOG"
      rm -f "$BODY" "$FILELIST"
      pause_exit 1
    fi
    if [ "$STATUS" = "503" ]; then
      echo ""
      echo "The server is not accepting uploads right now (HTTP 503)."
      echo "Contact the dev team, then run this again."
      echo "ABORTED	server unavailable (HTTP 503)" >> "$LOG"
      rm -f "$BODY" "$FILELIST"
      pause_exit 1
    fi
    if [ "$STATUS" = "200" ]; then
      if grep -q '"skipped":true' "$BODY"; then
        REASON="$(sed -n 's/.*"reason":"\([^"]*\)".*/\1/p' "$BODY")"
        SKIPPED=$((SKIPPED + 1))
        echo "  - skipped     $REL (${REASON:-already there})"
        echo "SKIPPED	$REL	$REASON" >> "$LOG"
      else
        KIND="$(sed -n 's/.*"docKind":"\([^"]*\)".*/\1/p' "$BODY")"
        STAGED=$((STAGED + 1))
        echo "  + uploaded    $REL [${KIND:-file}]"
        echo "STAGED	$REL	$KIND" >> "$LOG"
      fi
      OK=1; rm -f "$BODY"; break
    elif [ "$STATUS" -ge 400 ] && [ "$STATUS" -lt 500 ]; then
      # Surface the server's explanation ("expected Client/Fiscal year/…",
      # "upload corrupted?", …) instead of a bare status number.
      WHY="$(sed -n 's/.*"error":"\([^"]*\)".*/\1/p' "$BODY")"
      FAILED=$((FAILED + 1))
      echo "  x rejected    $REL (HTTP $STATUS${WHY:+ — $WHY})"
      echo "REJECTED	$REL	HTTP $STATUS	$WHY" >> "$LOG"
      OK=1; rm -f "$BODY"; break
    fi
    rm -f "$BODY"
    # Back off before the next try; no pointless sleep after the last one.
    [ "$ATTEMPT" -lt 3 ] && sleep $((2 ** ATTEMPT))
  done
  if [ "$OK" -eq 0 ]; then
    FAILED=$((FAILED + 1))
    echo "  x failed      $REL (network)"
    echo "FAILED	$REL	network" >> "$LOG"
  fi
done < "$FILELIST"
rm -f "$FILELIST"

echo ""
echo "Done. Uploaded: $STAGED   Skipped: $SKIPPED   Too large: $TOO_LARGE   Failed: $FAILED"
echo "A log was saved to upload-log.txt next to this script."
echo "Files now wait in the Banhall review queue - nothing is in the AI until approved."
pause_exit 0
