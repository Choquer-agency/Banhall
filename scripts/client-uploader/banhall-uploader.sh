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
# Uses only tools that ship with macOS: bash 3.2, find, shasum, curl, stat.
# Configuration comes from uploader-config.json next to this script.
# The only file written is upload-log.txt next to this script.
#
# Everything above the BANHALL_UPLOADER_LIB_ONLY guard is definitions only, so
# tests/run-tests.sh can source this file and call the functions directly.
# Keep it that way: nothing that reads the config or the network may move up.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/uploader-config.json"
LOG="$SCRIPT_DIR/upload-log.txt"

ALLOWED_EXT=".docx .doc .pdf .txt .vtt"
MAX_BYTES=$((15 * 1024 * 1024))
TEST_CAP=100

APP_URL=""; KEY=""
STAGED=0; SKIPPED=0; TOO_LARGE=0; FAILED=0
LOG_STARTED=0; LOG_WRITTEN=0
SCAN_WALKED=0; SCAN_LINK=0; SCAN_TEMP=0; SCAN_DOTFILE=0; SCAN_EXTENSION=0; SCAN_ERRORS=0

pause_exit() { echo ""; read -r -p "Press Enter to close " _; exit "${1:-0}"; }

# Our own controlled config format — simple key extraction is fine here.
json_get() {
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG" | head -1
}

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

# ok | is_file | missing. A path typed or remembered in the config can be any
# of the three, and "not a folder" is not the same problem as "not there".
root_state() {
  if [ -z "$1" ]; then echo "missing"; return; fi
  if [ -d "$1" ]; then echo "ok"; return; fi
  if [ -e "$1" ]; then echo "is_file"; return; fi
  echo "missing"
}

# Stop on anything that is not a folder to scan. A file path is a different
# mistake from a missing one and gets its own message.
require_folder() {
  case "$(root_state "$1")" in
    ok) return 0 ;;
    is_file)
      echo "That path is a file, not a folder: $1"
      echo "Choose the folder that holds your client documents instead."
      pause_exit 1
      ;;
    *)
      echo "That folder does not exist: $1"
      pause_exit 1
      ;;
  esac
}

# yes | no | unknown, from the OneDrive folders this machine actually has.
# The auto-detect probe only picks a folder to offer; it says nothing about the
# root that was finally chosen. "unknown" is a real answer: with no OneDrive
# folder present there is nothing to compare against.
under_onedrive() {
  local root="${1%/}" od found=0
  for od in "$HOME/Library/CloudStorage"/OneDrive* "$HOME"/OneDrive*; do
    [ -d "$od" ] || continue
    found=1
    od="${od%/}"
    [ "$root" = "$od" ] && { echo "yes"; return; }
    case "$root" in "$od"/*) echo "yes"; return ;; esac
  done
  if [ "$found" -eq 1 ]; then echo "no"; else echo "unknown"; fi
}

# Log incrementally: a crash, Ctrl-C, or closed window mid-run must not lose
# the record of what was already sent. The previous run's log is cleared by the
# first line this run writes, not up front, so a read-only kit folder still
# prints the zero-result diagnostics instead of dying on the truncation, and a
# run that logs nothing leaves the last real log alone. LOG_WRITTEN is what the
# closing lines are allowed to claim: pointing the client at a file that was
# never written recreates the unactionable report this diagnostics block exists
# to end.
log_line() {
  if [ "$LOG_STARTED" -eq 0 ]; then
    : 2>/dev/null > "$LOG" || return 0
    LOG_STARTED=1
  fi
  printf '%s\n' "$1" 2>/dev/null >> "$LOG" || return 0
  LOG_WRITTEN=1
}

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

# Lowercase extension including the dot, or "(none)". Matches .NET's
# GetExtension, which the Windows histogram uses: ".hidden" has no extension,
# ".hidden.docx" has ".docx".
ext_of() {
  local base="${1##*/}"
  case "$base" in
    ?*.*) printf '%s\n' ".${base##*.}" | tr '[:upper:]' '[:lower:]' ;;
    *) echo "(none)" ;;
  esac
}

is_allowed_ext() {
  case " $ALLOWED_EXT " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# Empty when the file is a candidate, otherwise the reason it was skipped:
# link | temp | dotfile | extension. Checked in that order, so a symlink named
# "~$notes.docx" reports "link". $2 is 1 when the entry is a symlink.
skip_reason() {
  local name="${1##*/}" is_link="$2"
  [ "$is_link" = "1" ] && { echo "link"; return; }
  case "$name" in
    '~$'*) echo "temp"; return ;;
    .*) echo "dotfile"; return ;;
  esac
  is_allowed_ext "$(ext_of "$name")" || echo "extension"
}

# Walk one root: append "rel<TAB>fullpath" candidate lines to $FILELIST, one
# lowercase extension per walked entry to $EXTLIST, and leave the per-reason
# tally in the SCAN_* globals (reset here, so they describe this root alone).
#
# find never follows symlinks, so the old `-type f` filter dropped them
# silently. Walking `-type f -o -type l` and classifying in the loop is what
# makes every skip countable instead of invisible.
collect_candidates() {
  local root="$1" prefix="$2" f name reason errfile is_link
  SCAN_WALKED=0; SCAN_LINK=0; SCAN_TEMP=0; SCAN_DOTFILE=0; SCAN_EXTENSION=0; SCAN_ERRORS=0
  : > "$EXTLIST"
  errfile="$(mktemp)"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    SCAN_WALKED=$((SCAN_WALKED + 1))
    name="${f##*/}"
    ext_of "$name" >> "$EXTLIST"
    if [ -L "$f" ]; then is_link=1; else is_link=0; fi
    reason="$(skip_reason "$name" "$is_link")"
    case "$reason" in
      link) SCAN_LINK=$((SCAN_LINK + 1)) ;;
      temp) SCAN_TEMP=$((SCAN_TEMP + 1)) ;;
      dotfile) SCAN_DOTFILE=$((SCAN_DOTFILE + 1)) ;;
      extension) SCAN_EXTENSION=$((SCAN_EXTENSION + 1)) ;;
      *) printf '%s\t%s\n' "$prefix${f#"$root"/}" "$f" >> "$FILELIST" ;;
    esac
  done < <(find "$root" \( -type f -o -type l \) -print 2>"$errfile")
  SCAN_ERRORS="$(wc -l < "$errfile" | tr -d ' ')"
  rm -f "$errfile"
}

# The block a client screenshots when the scan finds nothing. Counts and
# extensions only, never a file name, so the screenshot carries no document
# titles. $1 is an under_onedrive answer (yes | no | unknown).
format_scan_diagnostics() {
  local seen
  echo "Walked: $SCAN_WALKED files"
  echo "Skipped - link: $SCAN_LINK"
  echo "Skipped - temp: $SCAN_TEMP"
  echo "Skipped - dotfile: $SCAN_DOTFILE"
  echo "Skipped - extension: $SCAN_EXTENSION"
  echo "Access errors: $SCAN_ERRORS"
  # Top 8: enough to name what the folder actually holds, short enough that the
  # whole block fits in one screenshot. Ties break alphabetically so two runs
  # of the same folder print the same block.
  seen="$(sort "$EXTLIST" | uniq -c | sort -k1,1nr -k2,2 | head -8 |
    awk '{ printf "%s%s (%s)", (NR > 1 ? ", " : ""), $2, $1 } END { print "" }')"
  if [ -n "$seen" ]; then echo "Extensions seen: $seen"; else echo "Extensions seen: none"; fi
  echo "Under OneDrive sync root: $1"
}

file_size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
file_mtime_ms() {
  local s
  s="$(stat -f%m "$1" 2>/dev/null || stat -c%Y "$1")"
  echo "$((s * 1000))"
}

# Empty output means the file could not be read — a locked, ACL-denied or
# failed-to-hydrate file. The caller turns that into READ_ERROR instead of
# sending a request with an empty hash in the URL.
sha256_of() {
  local out=""
  if command -v shasum >/dev/null 2>&1; then out="$(shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1)"
  elif command -v sha256sum >/dev/null 2>&1; then out="$(sha256sum "$1" 2>/dev/null | cut -d' ' -f1)"
  elif command -v openssl >/dev/null 2>&1; then out="$(openssl dgst -sha256 "$1" 2>/dev/null | sed 's/.*= *//')"
  fi
  case "$out" in
    ""|*[!0-9a-fA-F]*) return 0 ;;
    *) printf '%s\n' "$out" ;;
  esac
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

upload_one() {
  local REL="$1" FILE="$2" SIZE HASH MTIME URI OK ATTEMPT BODY STATUS REASON KIND WHY
  SIZE="$(file_size "$FILE")"
  if [ "$SIZE" -gt "$MAX_BYTES" ]; then
    TOO_LARGE=$((TOO_LARGE + 1))
    echo "  - too large   $REL"
    log_line "TOO_LARGE	$REL"
    return 0
  fi
  HASH="$(sha256_of "$FILE")"
  if [ -z "$HASH" ]; then
    FAILED=$((FAILED + 1))
    echo "  x unreadable  $REL"
    log_line "READ_ERROR	$REL"
    return 0
  fi
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
      log_line "ABORTED	access key rejected (HTTP $STATUS)"
      rm -f "$BODY"
      pause_exit 1
    fi
    if [ "$STATUS" = "503" ]; then
      echo ""
      echo "The server is not accepting uploads right now (HTTP 503)."
      echo "Contact the dev team, then run this again."
      log_line "ABORTED	server unavailable (HTTP 503)"
      rm -f "$BODY"
      pause_exit 1
    fi
    if [ "$STATUS" = "200" ]; then
      if grep -q '"skipped":true' "$BODY"; then
        REASON="$(sed -n 's/.*"reason":"\([^"]*\)".*/\1/p' "$BODY")"
        SKIPPED=$((SKIPPED + 1))
        echo "  - skipped     $REL (${REASON:-already there})"
        log_line "SKIPPED	$REL	$REASON"
      else
        KIND="$(sed -n 's/.*"docKind":"\([^"]*\)".*/\1/p' "$BODY")"
        STAGED=$((STAGED + 1))
        echo "  + uploaded    $REL [${KIND:-file}]"
        log_line "STAGED	$REL	$KIND"
      fi
      OK=1; rm -f "$BODY"; break
    elif [ "$STATUS" -ge 400 ] && [ "$STATUS" -lt 500 ]; then
      # Surface the server's explanation ("expected Client/Fiscal year/…",
      # "upload corrupted?", …) instead of a bare status number.
      WHY="$(sed -n 's/.*"error":"\([^"]*\)".*/\1/p' "$BODY")"
      FAILED=$((FAILED + 1))
      echo "  x rejected    $REL (HTTP $STATUS${WHY:+ — $WHY})"
      log_line "REJECTED	$REL	HTTP $STATUS	$WHY"
      OK=1; rm -f "$BODY"; break
    fi
    rm -f "$BODY"
    # Back off before the next try; no pointless sleep after the last one.
    [ "$ATTEMPT" -lt 3 ] && sleep $((2 ** ATTEMPT))
  done
  if [ "$OK" -eq 0 ]; then
    FAILED=$((FAILED + 1))
    echo "  x failed      $REL (network)"
    log_line "FAILED	$REL	network"
  fi
}

# tests/run-tests.sh sources this file to call the functions above. Everything
# below runs the actual upload.
if [ "${BANHALL_UPLOADER_LIB_ONLY:-0}" = "1" ]; then
  return 0
fi

if [ ! -f "$CONFIG" ]; then
  echo "Missing uploader-config.json next to this script."
  pause_exit 1
fi
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
FILE_ARG=""
if [ "$#" -gt 0 ]; then
  DROPPED_MODE=1
  for p in "$@"; do
    case "$(root_state "$p")" in
      ok) ROOTS+=("$(cd "$p" && pwd)") ;;
      is_file)
        # One stray file alongside real folders must not kill the run; only a
        # run left with no folder at all reports it as the root mistake.
        [ -n "$FILE_ARG" ] || FILE_ARG="$p"
        echo "  ! skipped (pass folders, not single files): $p"
        ;;
      *) echo "  ! skipped (not found): $p" ;;
    esac
  done
  if [ "${#ROOTS[@]}" -eq 0 ]; then
    [ -n "$FILE_ARG" ] && require_folder "$FILE_ARG"
    echo "None of the given paths were folders."
    pause_exit 1
  fi
else
  FOUND_ONEDRIVE=""
  # A remembered folder is a default, not a lock-in: confirm it each run and
  # offer the chooser again (client feedback Aug 18).
  case "$(root_state "$ROOT")" in
    ok)
      echo "Last time you scanned:"
      echo "  $ROOT"
      read -r -p "Scan this folder again? (y = yes / c = choose a different folder) " AGAIN || AGAIN=""
      case "$AGAIN" in
        y|Y|yes|YES) : ;;
        *) ROOT="$(pick_folder "$ROOT")" ;;
      esac
      ;;
    is_file)
      # A remembered path that now names a file is a broken config, not a
      # folder to guess past: stop the same way a typed one does.
      require_folder "$ROOT"
      ;;
    *)
      if [ -n "$ROOT" ]; then
        echo "The remembered folder no longer exists: $ROOT"
        ROOT=""
      fi
      ;;
  esac
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
  require_folder "$ROOT"
  ROOT="$(cd "$ROOT" && pwd)"
  # Persist so the next run scans the same folder without asking again.
  save_root "$ROOT"
  ROOTS=("$ROOT")
fi

echo ""
echo "Banhall document uploader"
for r in "${ROOTS[@]}"; do
  echo "  Scanning (read-only): $r"
done
echo "  Uploading to:         $APP_URL/ingestion/upload"
echo ""

FILELIST="$(mktemp)"
EXTLIST="$(mktemp)"
SCANLOG="$(mktemp)"
SORTED="$(mktemp)"
trap 'rm -f "$FILELIST" "$EXTLIST" "$SCANLOG" "$SORTED"' EXIT
for r in "${ROOTS[@]}"; do
  PREFIX=""
  if [ "$DROPPED_MODE" -eq 1 ]; then PREFIX="$(drop_prefix "$r")"; fi
  collect_candidates "$r" "$PREFIX"
  # The SCAN_* globals describe one root, so the block is rendered now, while
  # they still hold this root's numbers.
  if [ "${#ROOTS[@]}" -gt 1 ]; then echo "Root: $r" >> "$SCANLOG"; fi
  format_scan_diagnostics "$(under_onedrive "$r")" >> "$SCANLOG"
done
# sort -u drops duplicate rels from nested/overlapping argument folders.
sort -u -t "$(printf '\t')" -k1,1 "$FILELIST" > "$SORTED"
mv "$SORTED" "$FILELIST"
COUNT="$(wc -l < "$FILELIST" | tr -d ' ')"

echo "Found $COUNT document(s) (.docx/.doc/.pdf/.txt/.vtt)."

# Zero found is the report that used to arrive with nothing to act on. Print
# and log the breakdown: counts and extensions only, never a document name.
if [ "$COUNT" -eq 0 ]; then
  while IFS= read -r line; do
    echo "  $line"
    log_line "SCAN	$line"
  done < "$SCANLOG"
  if [ "$LOG_WRITTEN" -eq 1 ]; then
    echo "The same breakdown was saved to upload-log.txt - send that file to the dev team."
  else
    echo "Could not write upload-log.txt next to the script - send a screenshot of this window instead."
  fi
  echo "Nothing to upload."
  pause_exit 0
fi

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
    *) echo "Cancelled. Nothing was uploaded."; pause_exit 0 ;;
  esac
fi

while IFS=$'\t' read -r REL FILE; do
  upload_one "$REL" "$FILE"
done < "$FILELIST"

echo ""
echo "Done. Uploaded: $STAGED   Skipped: $SKIPPED   Too large: $TOO_LARGE   Failed: $FAILED"
if [ "$LOG_WRITTEN" -eq 1 ]; then
  echo "A log was saved to upload-log.txt next to this script."
else
  echo "Could not write upload-log.txt next to this script - send a screenshot of this window instead."
fi
echo "Files now wait in the Banhall review queue - nothing is in the AI until approved."
pause_exit 0
