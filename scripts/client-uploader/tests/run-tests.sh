#!/bin/bash
# Test harness for the scan/upload helpers in banhall-uploader.sh. Plain bash,
# no framework.
#
#   bash scripts/client-uploader/tests/run-tests.sh
#
# Exits 1 if any case fails. Sources the uploader with
# BANHALL_UPLOADER_LIB_ONLY=1, so the config is never read, the network is
# never touched and the real upload-log.txt is never written (LOG is repointed
# at a temp file). Re-execs under /bin/bash: the client's Mac ships bash 3.2, so
# a bash-4-only construct has to fail here rather than on their machine.
#
# --inject-failure adds one always-failing case. The AC5 fail-path case re-runs
# this file with that switch to prove a failing case really fails the gate.

if [ -x /bin/bash ] && [ "${BANHALL_HARNESS_REEXEC:-0}" != "1" ]; then
  export BANHALL_HARNESS_REEXEC=1
  exec /bin/bash "$0" "$@"
fi

set -u

INJECT=0
[ "${1:-}" = "--inject-failure" ] && INJECT=1

HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$(dirname "$HERE")"
REPO="$(cd "$KIT/../.." && pwd)"
UPLOADER="$KIT/banhall-uploader.sh"

SANDBOX="$(mktemp -d)"
# A space and a non-ASCII character in every path: client folders have both,
# and an unquoted expansion has to fail here.
TMP="$SANDBOX/uploader tests ünï"
mkdir -p "$TMP/bin"
trap 'chmod -R u+rwX "$SANDBOX" 2>/dev/null; rm -rf "$SANDBOX"' EXIT

BANHALL_UPLOADER_LIB_ONLY=1 . "$UPLOADER"

# collect_candidates and format_scan_diagnostics write through these; the
# uploader sets them below the guard, so the harness owns them here.
FILELIST="$TMP/filelist.tsv"
EXTLIST="$TMP/extlist.txt"
LOG="$TMP/upload-log.txt"

pass=0
fail=0

# Each case is a function that echoes a problem (or nothing when it passes).
check() {
  local name="$1" fn="$2" problem rc
  problem="$("$fn" 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail=$((fail + 1)); echo "FAIL  $name - exited $rc: $problem"
  elif [ -n "$problem" ]; then
    fail=$((fail + 1)); echo "FAIL  $name - $problem"
  else
    pass=$((pass + 1)); echo "ok    $name"
  fi
}

expect() {
  [ "$2" = "$3" ] || echo "$1 expected '$2', got '$3'"
}

case_injected_failure() { echo "injected on purpose"; }
[ "$INJECT" -eq 1 ] && check "AC5 injected failing case (self-test only)" case_injected_failure

# --- fixtures ---------------------------------------------------------------
CORPUS="$TMP/corpus"
TREE="$CORPUS/Client A/Fiscal 2024"
mkdir -p "$TREE"
echo a > "$TREE/report.docx"
echo b > "$TREE/REPORT2.DOCX"
echo c > "$TREE/notes.md"
echo d > "$TREE/~\$temp.docx"
echo e > "$TREE/.hidden.docx"
ln -s "$TREE/report.docx" "$TREE/link.docx"
mkdir -p "$CORPUS/Client Ünïcode/Fiscal 2024"
echo f > "$CORPUS/Client Ünïcode/Fiscal 2024/résumé.pdf"

ZERO="$TMP/zero"; mkdir -p "$ZERO"
echo x > "$ZERO/notes.md"; echo x > "$ZERO/readme.md"; echo x > "$ZERO/data.csv"

EMPTY="$TMP/empty"; mkdir -p "$EMPTY"

HIST="$TMP/hist"; mkdir -p "$HIST"
for n in 1 2 3; do echo x > "$HIST/f$n.aa"; done
for n in 1 2; do echo x > "$HIST/g$n.bb"; echo x > "$HIST/h$n.cc"; done
for e in dd ee ff gg hh ii; do echo x > "$HIST/one.$e"; done

# --- AC1 + AC4: classification and per-reason counts -------------------------
case_collect() {
  : > "$FILELIST"
  collect_candidates "$CORPUS" ""
  local rels
  rels="$(cut -f1 "$FILELIST" | LC_ALL=C sort | tr '\n' '|')"
  (expect "walked" 7 "$SCAN_WALKED"
   expect "link" 1 "$SCAN_LINK"
   expect "temp" 1 "$SCAN_TEMP"
   expect "dotfile" 1 "$SCAN_DOTFILE"
   expect "extension" 1 "$SCAN_EXTENSION"
   expect "errors" 0 "$SCAN_ERRORS"
   expect "candidates" 3 "$(wc -l < "$FILELIST" | tr -d ' ')"
   expect "rels" "Client A/Fiscal 2024/REPORT2.DOCX|Client A/Fiscal 2024/report.docx|Client Ünïcode/Fiscal 2024/résumé.pdf|" "$rels") | head -1
}
check "AC1 walk classifies link/temp/dotfile/extension and keeps 3 candidates" case_collect

case_symlink_is_link() {
  : > "$FILELIST"
  collect_candidates "$TREE" ""
  (expect "link count" 1 "$SCAN_LINK"
   expect "link is not a candidate" 0 "$(grep -c 'link\.docx' "$FILELIST" | tr -d ' ')") | head -1
}
check "AC4 symlink to an allowed file is skipped and counted under link" case_symlink_is_link

case_prefix() {
  : > "$FILELIST"
  collect_candidates "$TREE" "Client A/Fiscal 2024/"
  expect "prefixed rel" "Client A/Fiscal 2024/report.docx" "$(cut -f1 "$FILELIST" | grep 'report.docx$' | head -1)"
}
check "AC1 argument prefix is prepended to the relative path" case_prefix

# --- AC1: the zero-result diagnostics block ---------------------------------
case_zero_diagnostics() {
  : > "$FILELIST"
  collect_candidates "$ZERO" ""
  local block
  block="$(format_scan_diagnostics no)"
  (expect "candidates" 0 "$(wc -l < "$FILELIST" | tr -d ' ')"
   expect "walked" "Walked: 3 files" "$(echo "$block" | sed -n 1p)"
   expect "link" "Skipped - link: 0" "$(echo "$block" | sed -n 2p)"
   expect "temp" "Skipped - temp: 0" "$(echo "$block" | sed -n 3p)"
   expect "dotfile" "Skipped - dotfile: 0" "$(echo "$block" | sed -n 4p)"
   expect "extension" "Skipped - extension: 3" "$(echo "$block" | sed -n 5p)"
   expect "errors" "Access errors: 0" "$(echo "$block" | sed -n 6p)"
   expect "extensions" "Extensions seen: .md (2), .csv (1)" "$(echo "$block" | sed -n 7p)"
   expect "onedrive" "Under OneDrive sync root: no" "$(echo "$block" | sed -n 8p)") | head -1
}
check "AC1 zero-result block reports walked, per-reason skips, extensions, OneDrive" case_zero_diagnostics

case_empty_folder() {
  : > "$FILELIST"
  collect_candidates "$EMPTY" ""
  local block
  block="$(format_scan_diagnostics unknown)"
  (expect "walked" "Walked: 0 files" "$(echo "$block" | sed -n 1p)"
   expect "extensions" "Extensions seen: none" "$(echo "$block" | sed -n 7p)") | head -1
}
check "edge empty folder reports zeros and 'Extensions seen: none'" case_empty_folder

case_histogram_top8() {
  : > "$FILELIST"
  collect_candidates "$HIST" ""
  expect "top 8, ties alphabetical" \
    "Extensions seen: .aa (3), .bb (2), .cc (2), .dd (1), .ee (1), .ff (1), .gg (1), .hh (1)" \
    "$(format_scan_diagnostics no | sed -n 7p)"
}
check "AC1 extension histogram is capped at 8, ties broken alphabetically" case_histogram_top8

case_ext_of() {
  (expect "plain" ".docx" "$(ext_of "report.docx")"
   expect "uppercase" ".docx" "$(ext_of "REPORT.DOCX")"
   expect "dotfile without a second dot" "(none)" "$(ext_of ".hidden")"
   expect "dotfile with an extension" ".docx" "$(ext_of ".hidden.docx")"
   expect "no extension" "(none)" "$(ext_of "Makefile")") | head -1
}
check "edge ext_of matches .NET GetExtension for dotfiles and bare names" case_ext_of

# --- AC3: a file where a folder belongs -------------------------------------
case_root_state() {
  (expect "folder" "ok" "$(root_state "$TREE")"
   expect "file" "is_file" "$(root_state "$TREE/report.docx")"
   expect "missing" "missing" "$(root_state "$TMP/nope")"
   expect "empty" "missing" "$(root_state "")") | head -1
}
check "AC3 root_state answers ok / is_file / missing" case_root_state

case_require_folder_file() {
  local out rc
  out="$( (require_folder "$TREE/report.docx") </dev/null 2>&1 )"
  rc=$?
  (expect "exit code" 1 "$rc"
   expect "message" "That path is a file, not a folder: $TREE/report.docx" "$(echo "$out" | sed -n 1p)") | head -1
}
check "AC3 a file path prints 'That path is a file, not a folder' and exits 1" case_require_folder_file

case_require_folder_ok_and_missing() {
  local out rc
  out="$( (require_folder "$TREE") </dev/null 2>&1 )"
  rc=$?
  local mout mrc
  mout="$( (require_folder "$TMP/nope") </dev/null 2>&1 )"
  mrc=$?
  (expect "folder exit code" 0 "$rc"
   expect "folder is silent" "" "$out"
   expect "missing exit code" 1 "$mrc"
   expect "missing message" "That folder does not exist: $TMP/nope" "$(echo "$mout" | sed -n 1p)") | head -1
}
check "AC3 a folder passes and a missing path reports 'does not exist'" case_require_folder_ok_and_missing

# --- AC2: an unreadable file never reaches the endpoint ----------------------
CURLLOG="$TMP/curl-calls.txt"
cat > "$TMP/bin/curl" <<STUB
#!/bin/bash
printf '%s\n' "\$*" >> "$CURLLOG"
echo 200
STUB
chmod +x "$TMP/bin/curl"
PATH="$TMP/bin:$PATH"

READDIR="$TMP/read"; mkdir -p "$READDIR"
echo secret > "$READDIR/locked.docx"
echo open > "$READDIR/open.docx"
chmod 000 "$READDIR/locked.docx"

case_read_error() {
  if [ "$(id -u)" = "0" ] || [ -r "$READDIR/locked.docx" ]; then
    echo "cannot make a file unreadable here (running as root?)"
    return 0
  fi
  : > "$CURLLOG"; : > "$LOG"
  LOG_STARTED=0; LOG_WRITTEN=0; FAILED=0; STAGED=0
  APP_URL="https://example.invalid"; KEY="harness"
  upload_one "read/locked.docx" "$READDIR/locked.docx" >/dev/null
  (expect "log line" "READ_ERROR	read/locked.docx" "$(sed -n 1p "$LOG")"
   expect "no endpoint call" 0 "$(wc -l < "$CURLLOG" | tr -d ' ')"
   expect "counted as failed" 1 "$FAILED") | head -1
}
check "AC2 an unreadable file logs READ_ERROR and never calls the endpoint" case_read_error

case_readable_file_does_call() {
  : > "$CURLLOG"; : > "$LOG"
  LOG_STARTED=0; LOG_WRITTEN=0; FAILED=0; STAGED=0
  APP_URL="https://example.invalid"; KEY="harness"
  upload_one "read/open.docx" "$READDIR/open.docx" >/dev/null
  (expect "staged" 1 "$STAGED"
   expect "endpoint called once" 1 "$(wc -l < "$CURLLOG" | tr -d ' ')"
   expect "log line" "STAGED	read/open.docx	" "$(sed -n 1p "$LOG")") | head -1
}
check "AC2 control: a readable file does reach the stubbed endpoint" case_readable_file_does_call

case_sha256_of() {
  if [ "$(id -u)" = "0" ] || [ -r "$READDIR/locked.docx" ]; then
    echo "cannot make a file unreadable here (running as root?)"
    return 0
  fi
  local good
  good="$(sha256_of "$READDIR/open.docx")"
  (expect "readable file hashes to 64 hex chars" 64 "${#good}"
   expect "unreadable file yields nothing" "" "$(sha256_of "$READDIR/locked.docx")"
   expect "missing file yields nothing" "" "$(sha256_of "$TMP/nope.docx")") | head -1
}
check "AC2 sha256_of returns nothing for an unreadable or missing file" case_sha256_of

# --- OneDrive detection -----------------------------------------------------
FAKEHOME="$TMP/home"
mkdir -p "$FAKEHOME/Library/CloudStorage/OneDrive-Banhall/Applications"
NOHOME="$TMP/nohome"; mkdir -p "$NOHOME"

case_under_onedrive() {
  local od="$FAKEHOME/Library/CloudStorage/OneDrive-Banhall"
  (expect "root itself" "yes" "$(HOME="$FAKEHOME" under_onedrive "$od")"
   expect "inside the root" "yes" "$(HOME="$FAKEHOME" under_onedrive "$od/Applications")"
   expect "outside the root" "no" "$(HOME="$FAKEHOME" under_onedrive "$ZERO")"
   expect "no OneDrive on the machine" "unknown" "$(HOME="$NOHOME" under_onedrive "$ZERO")") | head -1
}
check "AC1 under_onedrive answers yes / no / unknown" case_under_onedrive

# --- root prefix: the Client/Fiscal year ancestry of any chosen folder -------
# The Sept 9 bug: a folder chosen below the client level sent bare file names
# and the server rejected all of them. The prefix now comes from the root's
# own absolute path in every mode. Each expectation is one line of the spec's
# I/O matrix; the second has the exact shape of the root in the screenshot
# with placeholder names, a Windows path the Mac helper has to read the same
# way the Windows lib does. No real person or client name is committed here.
SCREENSHOT_ROOT='C:\Users\writer\Firm Ltd\Production - Documents\1. Applications\Client Co\2025-03-31\Submitted'
case_root_prefix_matrix() {
  (expect "the Applications folder itself" "" "$(root_prefix 'C:\Users\writer\Firm Ltd\Production - Documents\1. Applications')"
   expect "screenshot-shaped root below the client level" "Client Co/2025-03-31/Submitted/" "$(root_prefix "$SCREENSHOT_ROOT")"
   expect "loose anchor" "Client Co/2025-03-31/" "$(root_prefix 'C:\Users\writer\Production - Documents\1. Applications\Client Co\2025-03-31')"
   expect "bracketed anchor" "Client/FY2024/" "$(root_prefix 'C:\Users\writer\OneDrive - Firm\Applications [2024]\Client\FY2024')"
   expect "two anchors, last wins" "Client/FY2023/" "$(root_prefix 'C:\Users\writer\Applications\Archive\1. Applications\Client\FY2023')"
   expect "one-segment root" "" "$(root_prefix 'D:\Applications')"
   expect "no anchor, root is a corpus folder" "" "$(root_prefix 'D:\SRED Files')"
   expect "no anchor, root below the client level" "" "$(root_prefix 'D:\Scans\Client\FY2025')"
   expect "no anchor, root one level above Applications" "" "$(root_prefix 'C:\Users\writer\Firm Ltd\Production - Documents')"
   expect "dragged client folder" "Client Co/" "$(root_prefix 'C:\Users\writer\Production - Documents\1. Applications\Client Co')") | head -1
}
check "root-prefix I/O matrix on Windows-shaped paths" case_root_prefix_matrix

case_root_prefix_mac_paths() {
  (expect "below the client level" "Client Co/2025-03-31/Submitted/" "$(root_prefix '/Users/writer/Library/CloudStorage/OneDrive-Firm/1. Applications/Client Co/2025-03-31/Submitted')"
   expect "the Applications folder itself" "" "$(root_prefix '/Users/writer/OneDrive/Applications')"
   expect "upper-case anchor" "Client/FY2024/" "$(root_prefix '/Users/writer/APPLICATIONS/Client/FY2024')"
   expect "trailing slash" "Client/" "$(root_prefix '/Users/writer/Applications/Client/')"
   expect "no anchor" "" "$(root_prefix '/Volumes/Scans/Client/FY2025')"
   expect "empty path" "" "$(root_prefix '')") | head -1
}
check "root-prefix I/O matrix on Mac-shaped paths" case_root_prefix_mac_paths

# With IFS='/' the unquoted segment loop is also glob-expanded against cwd:
# "Client [2]" is a character class that matches a file named "Client 2".
GLOBDIR="$TMP/cwd with a match"; mkdir -p "$GLOBDIR"; : > "$GLOBDIR/Client 2"
# bash 3.2 cannot parse a case pattern's ")" inside $( ), so the probe is a
# named function.
glob_state() { case $- in *f*) echo off ;; *) echo on ;; esac; }
case_root_prefix_glob_safe() {
  local out state
  out="$(cd "$GLOBDIR" && root_prefix '/x/Applications [2024]/Client [2]/FY2024')"
  state="$(cd "$GLOBDIR" && root_prefix '/x/Applications [2024]/Client [2]/FY2024' >/dev/null; glob_state)"
  (expect "prefix with a matching file in cwd" "Client [2]/FY2024/" "$out"
   expect "globbing is restored afterwards" "on" "$state") | head -1
}
check "root-prefix a bracketed folder is not glob-expanded against the working directory" case_root_prefix_glob_safe

case_root_segments_drive_and_rel_sanitizing() {
  (expect "first segment dropped" "Applications|Client|" "$(root_segments 'C:\Applications\Client' | tr '\n' '|')"
   expect "a folder named X: deeper in a Mac path is kept" "Volumes|X:|Applications|Client|" "$(root_segments '/Volumes/X:/Applications/Client' | tr '\n' '|')"
   expect "prefix through it" "Client/" "$(root_prefix '/Volumes/X:/Applications/Client')"
   expect "a bare drive is no segment" "" "$(root_segments 'C:')"
   expect "rel segments trimmed, dot and dot-dot dropped, backslashes read" "Client / FY (1 file)|Client / FY2025 (1 file)|Client / FY2026 (1 file)|" \
     "$(printf '%s\n' ' Client / FY2025 /./x.docx' 'Client/../FY/x.docx' 'Client\FY2026\x.docx' | label_summary | tr '\n' '|')") | head -1
}
check "root-prefix a drive letter is dropped only as the first segment and rels count like sanitizeRelPath" case_root_segments_drive_and_rel_sanitizing

case_root_anchor_index() {
  (expect "screenshot-shaped root" 4 "$(root_anchor_index "$SCREENSHOT_ROOT")"
   expect "one-segment root" 0 "$(root_anchor_index 'D:\Applications')"
   expect "no anchor" -1 "$(root_anchor_index 'D:\Scans\Client\FY2025')"
   expect "empty path" -1 "$(root_anchor_index '')"
   expect "last of two" 4 "$(root_anchor_index 'C:\Users\writer\Applications\Archive\1. Applications\Client\FY2023')") | head -1
}
check "root-prefix root_anchor_index is -1 only when no segment contains 'applications'" case_root_anchor_index

# --- root prefix: the label summary printed before the y ---------------------
case_label_summary_order() {
  local out
  out="$(printf '%s\n' \
    "Beta Ltd/FY2023/PDs/a.docx" \
    "Client Co/2025-03-31/Submitted/x.docx" \
    "Client Co/2025-03-31/Submitted/y.docx" \
    "Client Co/2024-03-31/z.pdf" \
    "Beta Ltd/FY2023/b.docx" \
    "Client Co/2025-03-31/w.txt" | label_summary)"
  (expect "lines" 3 "$(echo "$out" | wc -l | tr -d ' ')"
   expect "first" "Client Co / 2025-03-31 (3 files)" "$(echo "$out" | sed -n 1p)"
   expect "second" "Beta Ltd / FY2023 (2 files)" "$(echo "$out" | sed -n 2p)"
   expect "third" "Client Co / 2024-03-31 (1 file)" "$(echo "$out" | sed -n 3p)") | head -1
}
check "root-prefix label_summary tallies Client / Fiscal year payloads, biggest first, ties by label" case_label_summary_order

case_label_summary_cap() {
  local out n
  out="$( (for n in 0 1 2 3 4 5 6 7; do echo "Client $n/FY/file.docx"; done; echo "Client 3/FY/second.docx") | label_summary)"
  (expect "cap is five" 5 "$LABEL_ROW_CAP"
   expect "cap rows plus the tail" $((LABEL_ROW_CAP + 1)) "$(echo "$out" | wc -l | tr -d ' ')"
   expect "biggest first" "Client 3 / FY (2 files)" "$(echo "$out" | sed -n 1p)"
   expect "then alphabetical" "Client 0 / FY (1 file)" "$(echo "$out" | sed -n 2p)"
   expect "tail" "(and 3 more)" "$(echo "$out" | sed -n "$((LABEL_ROW_CAP + 1))p")"
   expect "exactly cap has no tail" "$LABEL_ROW_CAP" "$( (for n in 0 1 2 3 4; do echo "Client $n/FY/f.docx"; done) | label_summary | wc -l | tr -d ' ')"
   expect "nothing found prints nothing" "" "$(printf '' | label_summary)") | head -1
}
check "root-prefix label_summary prints LABEL_ROW_CAP rows then 'and N more', nothing for no rels" case_label_summary_cap

case_label_summary_byte_order_and_empty_fields() {
  local out
  out="$(printf '%s\n' "beta/FY/a.docx" "Alpha/FY/b.docx" "/Volumes/Client/x.docx" | LC_ALL=en_US.UTF-8 label_summary)"
  (expect "ties break in byte order regardless of locale" "Alpha / FY (1 file)" "$(echo "$out" | sed -n 1p)"
   expect "then Volumes" "Volumes / Client (1 file)" "$(echo "$out" | sed -n 2p)"
   expect "then lower-case" "beta / FY (1 file)" "$(echo "$out" | sed -n 3p)") | head -1
}
check "root-prefix label_summary ties break in byte order and a leading slash is not a segment" case_label_summary_byte_order_and_empty_fields

case_label_summary_never_names_a_file() {
  local out
  out="$(printf '%s\n' "secret-client-memo.docx" "Client/secret-client-memo.docx" "Client/FY2024/ok.docx" | label_summary)"
  case "$out" in *secret-client*) echo "leaked a file name: $out"; return 0 ;; esac
  (expect "lines" 2 "$(echo "$out" | wc -l | tr -d ' ')"
   expect "short rels bucket" "(missing Client/Fiscal year folders) (2 files)" "$(echo "$out" | sed -n 1p)") | head -1
}
check "root-prefix a rel with a file name where a folder belongs never prints the file name" case_label_summary_never_names_a_file

# --- root prefix: the pre-upload check for a root with no anchor -------------
case_upload_refusal_ok() {
  (expect "corpus folder" "" "$(printf '%s\n' "Client/FY2025/x.docx" "Client/FY2025/PDs/y.pdf" | upload_refusal 'D:\SRED Files')"
   expect "no rels" "" "$(printf '' | upload_refusal 'D:\SRED Files')") | head -1
}
check "root-prefix upload_refusal accepts a no-anchor corpus folder whose files have Client and Fiscal-year folders" case_upload_refusal_ok

case_upload_refusal_short() {
  local out
  out="$(printf '%s\n' "secret-memo.docx" "Client/secret-memo.docx" "Client/FY2025/ok.docx" | upload_refusal 'D:\Scans\Client\FY2025')"
  case "$out" in *secret-memo*) echo "leaked a file name: $out"; return 0 ;; esac
  (expect "reason" '2 of 3 files under D:\Scans\Client\FY2025 would be sent without Client and Fiscal-year folders' "$(echo "$out" | sed -n 1p)"
   expect "guidance lines" 2 "$(echo "$out" | sed -n '2,$p' | wc -l | tr -d ' ')"
   expect "names the Applications folder" 1 "$(echo "$out" | grep -c 'Choose your Applications folder' | tr -d ' ')") | head -1
}
check "root-prefix upload_refusal refuses short rels with guidance naming the Applications folder and no document name" case_upload_refusal_short

case_upload_refusal_above() {
  local out root='/Users/writer/Firm Ltd/Production - Documents/'
  out="$(printf '%s\n' "1. Applications/Client Co/2025-03-31/x.docx" "1. Applications/Other/FY/y.docx" | upload_refusal "$root")"
  (expect "reason" "root sits above an Applications folder: $root (1 found)" "$(echo "$out" | sed -n 1p)"
   expect "names the child, trailing slash absorbed" "Choose this folder instead: /Users/writer/Firm Ltd/Production - Documents/1. Applications" "$(echo "$out" | sed -n 3p)"
   expect "child wins over short rels" "root sits above an Applications folder: $root (1 found)" "$(printf '%s\n' "1. Applications/x.docx" | upload_refusal "$root" | sed -n 1p)") | head -1
}
check "root-prefix upload_refusal refuses a root one level above Applications and names the child folder" case_upload_refusal_above

# A one-segment rel whose FILE NAME contains "applications" is a short rel,
# not a child Applications folder: the last segment is never a folder.
case_upload_refusal_file_name_is_not_a_child() {
  local out
  out="$(printf '%s\n' "SRED applications summary.docx" "Client/FY2025/ok.docx" | upload_refusal '/Volumes/Scans')"
  case "$out" in *summary.docx*) echo "leaked a file name: $out"; return 0 ;; esac
  (expect "short-rel refusal" "1 of 2 files under /Volumes/Scans would be sent without Client and Fiscal-year folders" "$(echo "$out" | sed -n 1p)"
   expect "two-segment file name is not a child either" "1 of 1 files under /x would be sent without Client and Fiscal-year folders" "$(printf '%s\n' "Client/applications notes.docx" | upload_refusal '/x' | sed -n 1p)") | head -1
}
check "root-prefix a file name containing 'applications' never becomes a child folder in the guidance" case_upload_refusal_file_name_is_not_a_child

# The check looks at every folder segment, not just the first: a root two
# levels above Applications is a wrong pick too, every matching folder is
# listed, and the paths mirror the root's own separator.
case_upload_refusal_deep_and_multiple() {
  local out root='C:\Users\writer'
  out="$(printf '%s\n' \
    "Firm Ltd/Production - Documents/1. Applications/Client Co/2025-03-31/x.docx" \
    "Firm Ltd/Archive/Applications [2023]/Old/FY/y.docx" \
    "Firm Ltd/Production - Documents/1. Applications/Other/FY/z.docx" | upload_refusal "$root")"
  (expect "reason" "root sits above an Applications folder: $root (2 found)" "$(echo "$out" | sed -n 1p)"
   expect "client named" 1 "$(echo "$out" | sed -n 2p | grep -c 'client "Firm Ltd"' | tr -d ' ')"
   expect "list header" "Choose one of these folders instead:" "$(echo "$out" | sed -n 3p)"
   expect "first path, backslashes" '  C:\Users\writer\Firm Ltd\Production - Documents\1. Applications' "$(echo "$out" | sed -n 4p)"
   expect "second path" '  C:\Users\writer\Firm Ltd\Archive\Applications [2023]' "$(echo "$out" | sed -n 5p)"
   expect "lines" 5 "$(echo "$out" | wc -l | tr -d ' ')") | head -1
}
check "root-prefix a root two levels above Applications is refused and every matching folder is listed" case_upload_refusal_deep_and_multiple

# --- root prefix: the auto-detect probe -------------------------------------
OD1="$TMP/od1"; OD2="$TMP/od2"
mkdir -p "$OD1/1. Applications" "$OD2/Applications Archive" "$OD2/Applications" "$OD2/Documents/Other"
case_guess_applications_root() {
  (expect "loose only" "$OD1/1. Applications" "$(guess_applications_root "$OD1")"
   expect "exact beats loose" "$OD2/Applications" "$(guess_applications_root "$OD2")"
   expect "nothing there" "" "$(guess_applications_root "$TMP/nope")"
   expect "empty root" "" "$(guess_applications_root "")") | head -1
}
check "root-prefix guess_applications_root offers a loosely named folder and prefers an exact one" case_guess_applications_root

# --- root prefix: the log records ---------------------------------------------
# announce_labels / warn_line / refuse_upload are what the wiring below the
# guard calls, so the record shapes and the log flags are proved here.
case_announce_labels_logs() {
  : > "$LOG"; LOG_STARTED=0; LOG_WRITTEN=0
  local out
  out="$(printf '%s\n' "Client Co/2025-03-31/x.docx" "Client Co/2025-03-31/y.docx" | announce_labels)"
  # Not a pipe this time: a pipeline stage is a subshell and the flags would
  # not come back. The next log_line must append, not truncate.
  announce_labels < <(printf '%s\n' "Client Co/2025-03-31/x.docx" "Client Co/2025-03-31/y.docx") >/dev/null
  log_line "SCAN	after"
  (expect "screen line" "  Labels: Client Co / 2025-03-31 (2 files)" "$out"
   expect "log flag reaches the caller" 1 "$LOG_WRITTEN"
   expect "log record is the bare payload" "LABELS	Client Co / 2025-03-31 (2 files)" "$(sed -n 1p "$LOG")"
   expect "later lines append" "SCAN	after" "$(sed -n 2p "$LOG")") | head -1
}
check "root-prefix announce_labels prints the lines and logs them as LABELS without re-truncating" case_announce_labels_logs

case_warn_line_logs() {
  : > "$LOG"; LOG_STARTED=0; LOG_WRITTEN=0
  local out
  out="$(warn_line 'No "Applications" folder above /x - treating it as the corpus folder')"
  (expect "screen line" '  ! No "Applications" folder above /x - treating it as the corpus folder' "$out"
   expect "log record" 'WARN	No "Applications" folder above /x - treating it as the corpus folder' "$(sed -n 1p "$LOG")") | head -1
}
check "root-prefix warn_line prints the note and logs it as WARN" case_warn_line_logs

case_refuse_upload_exits() {
  : > "$LOG"; LOG_STARTED=0; LOG_WRITTEN=0
  local out rc
  out="$( (refuse_upload "reason one
reason two" "guide a
guide b") </dev/null 2>&1 )"
  rc=$?
  (expect "exit code" 1 "$rc"
   expect "guidance printed" "  ! guide a|  ! guide b|" "$(echo "$out" | grep '^  ! ' | tr '\n' '|')"
   expect "nothing uploaded" 1 "$(echo "$out" | grep -c '^Nothing was uploaded' | tr -d ' ')"
   expect "one REFUSED record per reason" "REFUSED	reason one|REFUSED	reason two|" "$(tr '\n' '|' < "$LOG")") | head -1
}
check "root-prefix refuse_upload prints the guidance, logs REFUSED per reason and exits 1" case_refuse_upload_exits

# --- root prefix: a real tree in the screenshot's shape -----------------------
# Scanned below the client level, at the dragged-client level, from a
# no-anchor corpus folder, from a no-anchor folder below the client level and
# from one level above the Applications folder, with the rel composed exactly
# the way the uploader composes it (collect_candidates with root_prefix), so a
# regression in either half shows here.
ABOVE="$TMP/Production - Documents"
APPS="$ABOVE/1. Applications"
SUBMITTED="$APPS/Client Co/2025-03-31/Submitted"
mkdir -p "$SUBMITTED"
echo x > "$SUBMITTED/x.docx"
echo y > "$SUBMITTED/y.pdf"
SRED="$TMP/SRED Files"; mkdir -p "$SRED/Client/FY2025"; echo x > "$SRED/Client/FY2025/x.docx"
SCANS="$TMP/Scans/Client/FY2025"; mkdir -p "$SCANS"; echo x > "$SCANS/secret-memo.docx"

case_prefix_below_client_level() {
  : > "$FILELIST"
  collect_candidates "$SUBMITTED" "$(root_prefix "$SUBMITTED")"
  local rels short
  rels="$(cut -f1 "$FILELIST" | LC_ALL=C sort | tr '\n' '|')"
  short="$(cut -f1 "$FILELIST" | awk -F'/' 'NF < 3' | wc -l | tr -d ' ')"
  (expect "rels" "Client Co/2025-03-31/Submitted/x.docx|Client Co/2025-03-31/Submitted/y.pdf|" "$rels"
   expect "rels shorter than 3 segments" 0 "$short"
   expect "summary payload" "Client Co / 2025-03-31 (2 files)" "$(cut -f1 "$FILELIST" | label_summary | sed -n 1p)") | head -1
}
check "root-prefix a root below the client level sends Client/Fiscal year/... rels with 3+ segments" case_prefix_below_client_level

case_prefix_dragged_and_apps_root_agree() {
  local dragged apps
  : > "$FILELIST"
  collect_candidates "$APPS/Client Co" "$(root_prefix "$APPS/Client Co")"
  dragged="$(cut -f1 "$FILELIST" | LC_ALL=C sort | sed -n 1p)"
  : > "$FILELIST"
  collect_candidates "$APPS" "$(root_prefix "$APPS")"
  apps="$(cut -f1 "$FILELIST" | LC_ALL=C sort | sed -n 1p)"
  (expect "dragged client" "Client Co/2025-03-31/Submitted/x.docx" "$dragged"
   expect "Applications folder" "Client Co/2025-03-31/Submitted/x.docx" "$apps"
   expect "Applications prefix stays empty" "" "$(root_prefix "$APPS")") | head -1
}
check "root-prefix a dragged client folder and the Applications folder itself yield the same rels" case_prefix_dragged_and_apps_root_agree

case_no_anchor_corpus_folder_unchanged() {
  : > "$FILELIST"
  collect_candidates "$SRED" "$(root_prefix "$SRED")"
  (expect "anchor" -1 "$(root_anchor_index "$SRED")"
   expect "rel" "Client/FY2025/x.docx" "$(cut -f1 "$FILELIST")"
   expect "label payload" "Client / FY2025 (1 file)" "$(cut -f1 "$FILELIST" | label_summary)"
   expect "no refusal" "" "$(cut -f1 "$FILELIST" | upload_refusal "$SRED")") | head -1
}
check "root-prefix a no-anchor corpus folder keeps its rels, labels and no refusal, as before this fix" case_no_anchor_corpus_folder_unchanged

case_no_anchor_below_client_refused() {
  : > "$FILELIST"
  collect_candidates "$SCANS" "$(root_prefix "$SCANS")"
  local out
  out="$(cut -f1 "$FILELIST" | upload_refusal "$SCANS")"
  case "$out" in *secret-memo*) echo "leaked a file name: $out"; return 0 ;; esac
  (expect "rel is bare" "secret-memo.docx" "$(cut -f1 "$FILELIST")"
   expect "reason" "1 of 1 files under $SCANS would be sent without Client and Fiscal-year folders" "$(echo "$out" | sed -n 1p)") | head -1
}
check "root-prefix a no-anchor folder below the client level is refused without naming the document" case_no_anchor_below_client_refused

case_above_applications_refused() {
  : > "$FILELIST"
  collect_candidates "$ABOVE" "$(root_prefix "$ABOVE")"
  local out
  out="$(cut -f1 "$FILELIST" | upload_refusal "$ABOVE")"
  (expect "first segment is the child" 2 "$(cut -f1 "$FILELIST" | grep -c '^1\. Applications/' | tr -d ' ')"
   expect "reason" "root sits above an Applications folder: $ABOVE (1 found)" "$(echo "$out" | sed -n 1p)"
   expect "child named" "Choose this folder instead: $APPS" "$(echo "$out" | sed -n 3p)") | head -1
}
check "root-prefix a root one level above the Applications folder is refused and the child is named" case_above_applications_refused

TWO_ABOVE="$TMP/two above"; mkdir -p "$TWO_ABOVE"; mv "$ABOVE" "$TWO_ABOVE/"
ABOVE="$TWO_ABOVE/Production - Documents"; APPS="$ABOVE/1. Applications"; SUBMITTED="$APPS/Client Co/2025-03-31/Submitted"
case_two_above_applications_refused() {
  : > "$FILELIST"
  collect_candidates "$TWO_ABOVE" "$(root_prefix "$TWO_ABOVE")"
  local out
  out="$(cut -f1 "$FILELIST" | upload_refusal "$TWO_ABOVE")"
  (expect "reason" "root sits above an Applications folder: $TWO_ABOVE (1 found)" "$(echo "$out" | sed -n 1p)"
   expect "child named" "Choose this folder instead: $APPS" "$(echo "$out" | sed -n 3p)") | head -1
}
check "root-prefix a root two levels above the Applications folder is refused too" case_two_above_applications_refused

# --- executed runs: the uploader main path with folder arguments -------------
# Everything above proves the helpers; this runs banhall-uploader.sh itself
# against a throwaway kit (copied script, fake config, its own upload-log.txt)
# with stdin from /dev/null, so every prompt reads EOF and the run can only
# cancel. `read -p` prints its prompt only when stdin is a terminal, so
# "reached the prompt" is asserted through the cancel line that follows it.
KITTMP="$TMP/kit"; mkdir -p "$KITTMP"
cp "$UPLOADER" "$KITTMP/banhall-uploader.sh"
printf '{\n  "url": "https://example.invalid",\n  "key": "%s",\n  "root": ""\n}\n' "$(printf 'k%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40)" > "$KITTMP/uploader-config.json"
KITLOG="$KITTMP/upload-log.txt"
echo stray > "$APPS/stray.docx"
RUN_OUT=""; RUN_RC=0
run_uploader() {
  rm -f "$KITLOG"
  RUN_OUT="$(/bin/bash "$KITTMP/banhall-uploader.sh" "$1" </dev/null 2>&1)"
  RUN_RC=$?
}
case_exec_below_client_refused() {
  run_uploader "$SCANS"
  case "$RUN_OUT" in *"Scanning (read-only)"*) ;; *) echo "did not run: $RUN_OUT"; return 0 ;; esac
  (expect "exit" 1 "$RUN_RC"
   expect "REFUSED record" 1 "$(grep -c "^REFUSED	1 of 1 files under " "$KITLOG" | tr -d ' ')"
   expect "no document name in the log" 0 "$(grep -c 'secret-memo' "$KITLOG" | tr -d ' ')"
   expect "prompt never reached" 0 "$(printf '%s' "$RUN_OUT" | grep -c 'Cancelled\. Nothing was uploaded' | tr -d ' ')"
   expect "refused" 1 "$(printf '%s' "$RUN_OUT" | grep -c '^Nothing was uploaded\.' | tr -d ' ')") | head -1
}
check "executed a no-anchor folder below the client level exits 1 with a REFUSED record and never reaches the prompt" case_exec_below_client_refused

case_exec_corpus_folder_warns_and_prompts() {
  run_uploader "$SRED"
  (expect "exit" 0 "$RUN_RC"
   expect "LABELS payload" 1 "$(grep -c '^LABELS	Client / FY2025 (1 file)$' "$KITLOG" | tr -d ' ')"
   expect "WARN record" 1 "$(grep -c '^WARN	No "Applications" folder above ' "$KITLOG" | tr -d ' ')"
   expect "no REFUSED" 0 "$(grep -c '^REFUSED	' "$KITLOG" | tr -d ' ')"
   expect "prompt reached, cancelled on EOF" 1 "$(printf '%s' "$RUN_OUT" | grep -c 'Cancelled\. Nothing was uploaded' | tr -d ' ')") | head -1
}
check "executed a no-anchor corpus folder logs WARN, reaches the prompt and cancels on EOF" case_exec_corpus_folder_warns_and_prompts

case_exec_above_applications_refused() {
  run_uploader "$ABOVE"
  (expect "exit" 1 "$RUN_RC"
   expect "REFUSED record" 1 "$(grep -c '^REFUSED	root sits above an Applications folder: ' "$KITLOG" | tr -d ' ')"
   expect "child named on screen" 1 "$(printf '%s' "$RUN_OUT" | grep -c "Choose this folder instead: $APPS\$" | tr -d ' ')"
   expect "prompt never reached" 0 "$(printf '%s' "$RUN_OUT" | grep -c 'Cancelled\. Nothing was uploaded' | tr -d ' ')") | head -1
}
check "executed a root above the Applications folder exits 1 with REFUSED naming the child" case_exec_above_applications_refused

case_exec_anchored_stray_not_refused() {
  run_uploader "$APPS"
  (expect "exit" 0 "$RUN_RC"
   expect "no REFUSED" 0 "$(grep -c '^REFUSED	' "$KITLOG" | tr -d ' ')"
   expect "no WARN" 0 "$(grep -c '^WARN	' "$KITLOG" | tr -d ' ')"
   expect "stray counted without its name" 1 "$(grep -c '^LABELS	(missing Client/Fiscal year folders) (1 file)$' "$KITLOG" | tr -d ' ')"
   expect "no file name in the log" 0 "$(grep -c 'stray' "$KITLOG" | tr -d ' ')"
   expect "prompt reached, cancelled on EOF" 1 "$(printf '%s' "$RUN_OUT" | grep -c 'Cancelled\. Nothing was uploaded' | tr -d ' ')") | head -1
}
check "executed an anchored root with a stray file directly inside Applications is not refused and reaches the prompt" case_exec_anchored_stray_not_refused

# --- AC5: the gate runs this file, and a failing case fails the gate ---------
case_gate_runs_harness() {
  local hits
  hits="$(grep -c 'run-tests\.sh' "$REPO/scripts/loop-verify.sh" | tr -d ' ')"
  expect "invocations in loop-verify.sh" 1 "$hits"
}
check "AC5 scripts/loop-verify.sh runs this harness exactly once" case_gate_runs_harness

case_failing_case_fails_the_gate() {
  if "$0" --inject-failure >/dev/null 2>&1; then
    echo "the --inject-failure run exited 0; a failing case would not stop the gate"
  fi
}
[ "$INJECT" -eq 1 ] || check "AC5 an injected failing case exits non-zero" case_failing_case_fails_the_gate

# --- shape of the shipped script --------------------------------------------
# bash 4 constructs work on the machine that wrote them and die on the client's
# stock macOS bash 3.2. The gate is the only place that can catch them.
case_bash32_only() {
  local hits
  hits="$(grep -n -E 'declare -A|local -A|mapfile|readarray|\$\{[A-Za-z_][A-Za-z0-9_]*(\^\^|,,)|&>>' "$UPLOADER" || true)"
  expect "bash 4 constructs" "" "$hits"
}
check "shape banhall-uploader.sh uses no bash 4 constructs" case_bash32_only

case_lib_guard() {
  local guard defs_after
  guard="$(grep -n '^if \[ "\${BANHALL_UPLOADER_LIB_ONLY' "$UPLOADER" | head -1 | cut -d: -f1)"
  if [ -z "$guard" ]; then echo "no BANHALL_UPLOADER_LIB_ONLY guard"; return 0; fi
  defs_after="$(sed -n "$((guard + 1)),\$p" "$UPLOADER" | grep -c -E '^[a-z_][a-z0-9_]*\(\) \{' | tr -d ' ')"
  (expect "functions defined below the guard" 0 "$defs_after"
   expect "shebang" "#!/bin/bash" "$(sed -n 1p "$UPLOADER")") | head -1
}
check "shape every function is defined above the lib-only guard" case_lib_guard

# The prefix is derived from the root in every mode: the one collect_candidates
# call site is fed root_prefix with no mode switch in the way, the old
# drop-only helper is gone, the no-anchor check runs per root inside the loop
# only for roots with no anchor, and the labels, WARN note and refusal sit
# between the found count and the upload question.
case_root_prefix_wiring() {
  local guard below calls found summary warn refuse ask check_line
  guard="$(grep -n '^if \[ "\${BANHALL_UPLOADER_LIB_ONLY' "$UPLOADER" | head -1 | cut -d: -f1)"
  below="$(sed -n "$((guard + 1)),\$p" "$UPLOADER")"
  calls="$(echo "$below" | grep -c 'collect_candidates ' | tr -d ' ')"
  found="$(grep -n 'echo "Found \$COUNT document' "$UPLOADER" | head -1 | cut -d: -f1)"
  summary="$(grep -n '^announce_labels < <(cut -f1 "\$FILELIST")' "$UPLOADER" | head -1 | cut -d: -f1)"
  warn="$(grep -n '^  warn_line ' "$UPLOADER" | head -1 | cut -d: -f1)"
  refuse="$(grep -n '^  refuse_upload "\$REFUSAL_REASONS" "\$REFUSAL_GUIDANCE"' "$UPLOADER" | head -1 | cut -d: -f1)"
  ask="$(grep -n 'Upload them to the Banhall review queue now?' "$UPLOADER" | head -1 | cut -d: -f1)"
  check_line="$(grep -n 'upload_refusal "\$r")"' "$UPLOADER" | head -1 | cut -d: -f1)"
  (expect "drop_prefix is gone" 0 "$(grep -c 'drop_prefix' "$UPLOADER" | tr -d ' ')"
   expect "DROPPED_MODE switch is gone" 0 "$(grep -c 'DROPPED_MODE' "$UPLOADER" | tr -d ' ')"
   expect "one collect_candidates call site" 1 "$calls"
   expect "call site is fed root_prefix on the loop variable" 'collect_candidates "$r" "$(root_prefix "$r")"' "$(echo "$below" | grep 'collect_candidates ' | sed 's/^ *//')"
   expect "per-root check is guarded by a missing anchor" 1 "$(sed -n "$((check_line - 1))p" "$UPLOADER" | grep -c 'root_anchor_index "$r")" -lt 0' | tr -d ' ')"
   expect "labels printed and logged after the found count, not from a pipeline subshell" "yes" "$([ -n "$summary" ] && [ "$found" -lt "$summary" ] && echo yes || echo no)"
   expect "no pipe into announce_labels anywhere" 0 "$(grep -c '| announce_labels' "$UPLOADER" | tr -d ' ')"
   expect "WARN note between the count and the question" "yes" "$([ -n "$warn" ] && [ "$found" -lt "$warn" ] && [ "$warn" -lt "$ask" ] && echo yes || echo no)"
   expect "refusal between the count and the question" "yes" "$([ -n "$refuse" ] && [ "$found" -lt "$refuse" ] && [ "$refuse" -lt "$ask" ] && echo yes || echo no)"
   expect "refusal guarded by the reasons list" 1 "$(sed -n "$((refuse - 1))p" "$UPLOADER" | grep -c 'if \[ -n "\$REFUSAL_REASONS" \]' | tr -d ' ')"
   expect "probe goes through guess_applications_root" 1 "$(echo "$below" | grep -c 'guess_applications_root "$od"' | tr -d ' ')") | head -1
}
check "root-prefix every root gets root_prefix, the no-anchor check, and labels/WARN/refusal print before the question" case_root_prefix_wiring

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
