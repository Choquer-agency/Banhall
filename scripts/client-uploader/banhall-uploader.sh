#!/bin/bash
# Banhall document uploader — macOS/Linux version (Path B — BNH-17).
#
# Same behavior as banhall-uploader.ps1: walks your OneDrive "Applications"
# folder READ-ONLY (nothing modified, moved, or deleted; symlinks never
# followed) and uploads copies of past PDs / transcripts to the Banhall app's
# review queue. Nothing enters the AI knowledge base until an admin approves
# each file inside the app.
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
save_root() {
  printf '{\n  "url": "%s",\n  "key": "%s",\n  "root": "%s"\n}\n' \
    "$APP_URL" "$KEY" "$1" > "$CONFIG"
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

# Folder to scan: config "root" wins. Otherwise auto-detect the synced
# OneDrive folder (locations differ per machine: ~/OneDrive, "OneDrive - Org",
# ~/Library/CloudStorage/OneDrive-…), look for an "Applications" folder up to
# 3 levels deep, confirm the guess with the user, and let them pick the real
# folder if the guess is wrong — we can't assume every machine's layout.
FOUND_ONEDRIVE=""
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

MAX_BYTES=$((15 * 1024 * 1024))

echo ""
echo "Banhall document uploader"
echo "  Scanning (read-only): $ROOT"
echo "  Uploading to:         $APP_URL/ingestion/upload"
echo ""

# find does not follow symlinks by default; -type f also excludes them.
FILELIST="$(mktemp)"
find "$ROOT" -type f \
  \( -iname '*.docx' -o -iname '*.doc' -o -iname '*.pdf' -o -iname '*.txt' -o -iname '*.vtt' \) \
  ! -name '~$*' ! -name '.*' -print | sort > "$FILELIST"
COUNT="$(wc -l < "$FILELIST" | tr -d ' ')"

echo "Found $COUNT document(s) (.docx/.doc/.pdf/.txt/.vtt)."
if [ "$COUNT" -eq 0 ]; then rm -f "$FILELIST"; pause_exit 0; fi
read -r -p "Upload them to the Banhall review queue now? (y/n) " ANSWER
case "$ANSWER" in
  y|Y|yes|YES) : ;;
  *) echo "Cancelled. Nothing was uploaded."; rm -f "$FILELIST"; pause_exit 0 ;;
esac

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
  echo "$out"
}

STAGED=0; SKIPPED=0; TOO_LARGE=0; FAILED=0
: > "$LOG"

while IFS= read -r FILE; do
  REL="${FILE#"$ROOT"/}"
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
    STATUS="$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$URI" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$FILE" 2>/dev/null || echo 000)"
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
    elif [ "$STATUS" -ge 400 ] && [ "$STATUS" -lt 500 ] 2>/dev/null; then
      FAILED=$((FAILED + 1))
      echo "  x rejected    $REL (HTTP $STATUS)"
      echo "REJECTED	$REL	HTTP $STATUS" >> "$LOG"
      OK=1; rm -f "$BODY"; break
    fi
    rm -f "$BODY"
    sleep $((2 ** ATTEMPT))
  done
  if [ "$OK" -eq 0 ]; then
    FAILED=$((FAILED + 1))
    echo "  x failed      $REL (network)"
    echo "FAILED	$REL	network" >> "$LOG"
  fi
done < "$FILELIST"
rm -f "$FILELIST"

echo ""
echo "Done. Uploaded: $STAGED   Already there: $SKIPPED   Too large: $TOO_LARGE   Failed: $FAILED"
echo "A log was saved to upload-log.txt next to this script."
echo "Files now wait in the Banhall review queue - nothing is in the AI until approved."
pause_exit 0
