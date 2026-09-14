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
# their paths). Without arguments it uses the remembered/auto-detected root.
# In every mode the uploaded paths are rebuilt relative to the "Applications"
# folder in the chosen folder's own location (full path if none), so
# Client/Fiscal year context — and dedupe against full-folder runs — is
# preserved no matter which folder under Applications is chosen or passed.
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
# How many "Labels:" rows the scan prints before collapsing the rest into one
# "(and N more)" line: enough to confirm a pick, short enough for one screen.
LABEL_ROW_CAP=5
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

# Path segments of an absolute path, one per line, separator-agnostic and
# without the empty segments a leading "/" produces. A drive letter ("C:") is
# dropped only when it is the FIRST segment: a folder literally named "X:"
# deeper in a Mac path is a folder. Windows shapes are accepted so the harness
# can prove the same fixtures the Windows lib is proved on.
root_segments() {
  local abs seg restore_glob="" i=0
  abs="$(printf '%s' "$1" | tr '\\' '/')"
  # The unquoted $abs below is split on IFS, and every piece is then
  # glob-expanded against the working directory: a segment "Client [2]" turns
  # into "Client 2" when such a file sits in cwd. Globbing off, restored after.
  case $- in *f*) ;; *) set -f; restore_glob=1 ;; esac
  local IFS='/'
  for seg in $abs; do
    [ -n "$seg" ] || continue
    if [ "$i" -eq 0 ]; then
      case "$seg" in [A-Za-z]:) i=1; continue ;; esac
    fi
    i=$((i + 1))
    printf '%s\n' "$seg"
  done
  [ -z "$restore_glob" ] || set +f
}

# Index of the anchor segment in root_segments, or -1 when the path has none.
# The anchor is the corpus root: any segment containing "applications"
# (case-insensitive - clients name it "Applications", "1. Applications",
# "Applications [2024]"). The LAST match wins, so an archive folder that
# happens to sit above the live corpus does not steal the anchor.
root_anchor_index() {
  local seg last=-1 i=0
  while IFS= read -r seg; do
    case "$(printf '%s' "$seg" | tr '[:upper:]' '[:lower:]')" in
      *applications*) last=$i ;;
    esac
    i=$((i + 1))
  done < <(root_segments "$1")
  printf '%s' "$last"
}

# The "Client/Fiscal year/…/" prefix every relative path under $1 must carry
# so the server reads the right first two segments, whatever folder the user
# chose. Rebuilt from the root's own absolute path: the segments after the
# anchor, joined with "/" and ending in "/". The Applications folder itself
# yields "" (rels and dedupe keys unchanged for existing corpus uploads). A
# path with no anchor also yields "": the root is treated as the corpus folder
# itself, which is what every run did before this helper existed, so a
# remembered corpus root not named Applications keeps its labels and dedupe
# keys. upload_refusal is what stops the run when that assumption is wrong.
root_prefix() {
  local seg out="" last i=0
  last="$(root_anchor_index "$1")"
  [ "$last" -ge 0 ] || { printf ''; return 0; }
  while IFS= read -r seg; do
    if [ "$i" -gt "$last" ]; then out="$out$seg/"; fi
    i=$((i + 1))
  done < <(root_segments "$1")
  printf '%s' "$out"
}

# Segments of a rel are counted the way the server's sanitizeRelPath counts
# them (convex/lib/ingestionClassify.ts): backslashes become slashes, each
# segment is trimmed, and empty, "." and ".." segments are dropped. This awk
# fragment leaves the kept segments in seg[1..n]; label_summary and
# upload_refusal both start from it.
REL_SEGMENTS_AWK='
  { line = $0; gsub(/\\/, "/", line); m = split(line, raw, "/"); n = 0
    for (i = 1; i <= m; i++) { p = raw[i]; gsub(/^[ \t]+|[ \t]+$/, "", p)
      if (p != "" && p != "." && p != "..") seg[++n] = p } }'

# What the server will label each file with: one "Client / Fiscal year (N
# files)" payload per distinct first-two-segment pair of the rels on stdin,
# biggest first, ties broken by label in byte order (LC_ALL=C: deterministic
# on every Mac; the Windows lib sorts culture-aware, so mixed-case ties may
# order differently there), the top LABEL_ROW_CAP then one "(and N more)"
# payload so the block stays one screenful. announce_labels puts "Labels: "
# in front on screen and "LABELS<tab>" in the log. A rel with fewer than
# three segments has no fiscal-year folder; it is counted under a fixed label
# so no document name is printed.
label_summary() {
  awk "$REL_SEGMENTS_AWK"'
    { if (n >= 3) label = seg[1] " / " seg[2]; else label = "(missing Client/Fiscal year folders)"
      count[label]++ }
    END { for (label in count) printf "%d\t%s\n", count[label], label }' |
    LC_ALL=C sort -t "$(printf '\t')" -k1,1nr -k2,2 |
    awk -F'\t' -v cap="$LABEL_ROW_CAP" '
      NR <= cap { printf "%s (%s %s)\n", $2, $1, ($1 == 1 ? "file" : "files") }
      END { if (NR > cap) printf "(and %d more)\n", NR - cap }'
}

# The pre-upload check for a root with no Applications folder above it. Such a
# root is assumed to be the corpus folder (empty prefix); this is where that
# assumption is tested against what the scan found. Reads that root's rels on
# stdin; prints nothing when they look right, otherwise one reason line for
# the log followed by the guidance lines to print. No document name, ever.
#   - A FOLDER segment of a rel that matches the anchor pattern (never the
#     last segment, which is the file) means the root sits above the
#     Applications folder - one level ("Production - Documents" whose child
#     is "1. Applications") or more. Every file would be labelled with the
#     folders in between. Guidance names each such Applications folder by
#     its full path, built with the root's own separator.
#   - A rel with fewer than three segments has no fiscal-year folder: the
#     server rejects a one-segment path outright; it accepts two but
#     classifies with no fiscal year (docKind "unknown", pair key
#     "Client::?"), which is a mislabelled row in the review queue.
upload_refusal() {
  # ENVIRON, not -v: awk expands backslash escapes in -v values, and a Windows
  # root ("D:\Scans\…") loses its separators.
  ROOT="$1" awk "$REL_SEGMENTS_AWK"'
    { total++
      if (n < 3) short++
      for (i = 1; i < n; i++) if (tolower(seg[i]) ~ /applications/) {
        path = seg[1]; for (j = 2; j <= i; j++) path = path SUBSEP seg[j]
        if (!(path in seen)) { seen[path] = 1; order[++k] = path }
        if (client == "") client = seg[1]
        break } }
    END {
      root = ENVIRON["ROOT"]; sep = (index(root, "\\") > 0) ? "\\" : "/"
      base = root; sub(/[\/\\]+$/, "", base)
      if (k > 0) {
        printf "root sits above an Applications folder: %s (%d found)\n", root, k
        printf "The folder you chose sits above your Applications folder, so every file would be labelled with the client \"%s\".\n", client
        if (k == 1) { p = order[1]; gsub(SUBSEP, sep, p); printf "Choose this folder instead: %s%s%s\n", base, sep, p }
        else {
          printf "Choose one of these folders instead:\n"
          for (i = 1; i <= k; i++) { p = order[i]; gsub(SUBSEP, sep, p); printf "  %s%s%s\n", base, sep, p } }
      } else if (short > 0) {
        printf "%d of %d files under %s would be sent without Client and Fiscal-year folders\n", short, total, root
        printf "There is no \"Applications\" folder above the folder you chose, and %d of %d documents sit less than two folders below it, so they would arrive without a client or fiscal year.\n", short, total
        printf "Choose your Applications folder, or one client folder inside it, instead.\n"
      } }'
}

# The auto-detect probe: the folder to offer under a OneDrive root, or
# nothing. Walks up to three levels; a folder named exactly "Applications"
# wins, else the first folder whose name contains "applications" (so
# "1. Applications" is offered too), matching the anchor rule above.
guess_applications_root() {
  local hit
  [ -d "$1" ] || return 0
  hit="$(find "$1" -maxdepth 3 -type d -iname "Applications" 2>/dev/null | head -1)"
  [ -n "$hit" ] || hit="$(find "$1" -maxdepth 3 -type d -iname "*applications*" 2>/dev/null | head -1)"
  printf '%s' "$hit"
}

# Print "Labels: <payload>" for the rels on stdin and log each payload as a
# LABELS record (bare payload after the tab, like every other record). The loop
# reads a here-string, not a pipe: a pipeline stage is a subshell, and
# log_line's LOG_STARTED/LOG_WRITTEN would never reach this shell, so the next
# write would truncate the log and lose these very lines.
announce_labels() {
  local lines line
  lines="$(label_summary)"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    echo "  Labels: $line"
    log_line "LABELS	$line"
  done <<< "$lines"
}

# One yellow-style note on screen and a WARN record in the log.
warn_line() {
  echo "  ! $1"
  log_line "WARN	$1"
}

# Stop the run on refusals: $1 holds one reason line per refused root, $2 the
# guidance lines. Print the guidance, log each reason as REFUSED, exit without
# sending anything. Here-strings, not pipes, for the same reason as above.
refuse_upload() {
  local line
  echo ""
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    echo "  ! $line"
  done <<< "$2"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    log_line "REFUSED	$line"
  done <<< "$1"
  echo "Nothing was uploaded."
  pause_exit 1
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
FILE_ARG=""
if [ "$#" -gt 0 ]; then
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
      hit="$(guess_applications_root "$od")"
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
# The server reads clientName from the first path segment and fiscalYear from
# the second (`Client/Fiscal year/…`): it rejects a one-segment path; it
# accepts two but classifies the directory part alone, so the fiscal year is
# undefined and the item lands as docKind "unknown" (pair key "Client::?");
# three segments are what classification needs. A rel relative to the chosen
# folder alone is therefore only right when that folder IS the Applications
# folder. root_prefix rebuilds the
# ancestry from the root's own absolute path in every mode (remembered,
# chosen, argument): a folder below the client level still sends
# `Client/Fiscal year/…`, and the Applications folder itself yields an empty
# prefix, so existing uploads keep their dedupe keys. A root with no
# Applications folder above it also gets an empty prefix (it is taken to be
# the corpus folder, as every run did before), and upload_refusal checks that
# assumption against this root's own rels before anything is sent.
REFUSAL_REASONS=""
REFUSAL_GUIDANCE=""
UNANCHORED=()
for r in "${ROOTS[@]}"; do
  before="$(wc -l < "$FILELIST" | tr -d ' ')"
  collect_candidates "$r" "$(root_prefix "$r")"
  if [ "$(root_anchor_index "$r")" -lt 0 ]; then
    refusal="$(tail -n "+$((before + 1))" "$FILELIST" | cut -f1 | upload_refusal "$r")"
    if [ -n "$refusal" ]; then
      REFUSAL_REASONS="$REFUSAL_REASONS$(printf '%s\n' "$refusal" | sed -n 1p)
"
      REFUSAL_GUIDANCE="$REFUSAL_GUIDANCE$(printf '%s\n' "$refusal" | sed -n '2,$p')
"
    else
      UNANCHORED+=("$r")
    fi
  fi
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

# Show what the server will label the files with before asking for a y: the
# client and fiscal-year folders with a count, never a document name. The same
# lines go to the log so a mislabelled batch can be traced to the run.
# Process substitution, not a pipe: a pipeline stage is a subshell, and
# log_line's flags would not come back, so the next write would truncate the
# log and lose the LABELS lines.
announce_labels < <(cut -f1 "$FILELIST")
for r in ${UNANCHORED[@]+"${UNANCHORED[@]}"}; do
  warn_line "No \"Applications\" folder above $r - treating it as the corpus folder (client folders directly inside it)."
done

# A root with no Applications folder above it whose files would arrive
# without Client and Fiscal-year folders, or that sits above an Applications
# folder, is a wrong pick, not a batch to send: say which folder to choose and
# stop before the question. Reasons and guidance carry folder names only.
if [ -n "$REFUSAL_REASONS" ]; then
  refuse_upload "$REFUSAL_REASONS" "$REFUSAL_GUIDANCE"
fi

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
