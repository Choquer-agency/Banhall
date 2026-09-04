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

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
