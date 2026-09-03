---
key: uploader-3-mac-parity
status: todo
kind: feature
deps: [uploader-2-zero-found-diagnostics]
touches: [scripts]
risky: []
verify: [bash scripts/client-uploader/tests/run-tests.sh]
done_when: [test -f scripts/client-uploader/tests/run-tests.sh, "rg -q 'run-tests.sh' scripts/loop-verify.sh", "rg -q 'READ_ERROR' scripts/client-uploader/banhall-uploader.sh", "rg -q 'SCAN' scripts/client-uploader/banhall-uploader.sh", bash scripts/client-uploader/tests/run-tests.sh]
title: "Mac uploader mirrors the zero-result diagnostics, adds the missing READ_ERROR path and root-is-file check"
plan: 20260903-client-sync
updated: "2026-09-03T21:17:39.899Z"
---
## Intent
The Mac script (`banhall-uploader.sh`, run by `Run-Uploader.command`) must report the same scan facts as the Windows script so a Mac user's zero-result report is equally actionable, and it must not send a malformed URL when a file cannot be hashed. The maintainer inherits a bash harness in the gate and one place (`scan_diagnostics`) that formats the breakdown.

## Acceptance
- AC1: Given a folder where the filter yields zero files, when the script reaches the found-count step, then it prints `Found 0 document(s)` and a diagnostics block with `Walked`, per-reason skip counts (`link`, `temp`, `dotfile`, `extension`), `Extensions seen` (top 8), and `Under OneDrive sync root: yes|no|unknown`, and appends the same lines as `SCAN\t...` to `upload-log.txt`.
- AC2: Given a file that `shasum` cannot read, when the upload loop reaches it, then the script logs `READ_ERROR\t<rel>` and continues without calling the endpoint for that file.
- AC3: Given a `root` argument or JSON `root` that is a file, when the script validates it, then it prints `That path is a file, not a folder: <path>` and exits 1.
- AC4: Given a symlink to an allowed file inside the tree, when the scan runs, then the symlink is skipped and counted under `link` (current `find -type f` behaviour, now counted).
- AC5: `bash scripts/loop-verify.sh` runs `tests/run-tests.sh` and fails when any case fails.

## Verification
- AC1, AC4 → `scripts/client-uploader/tests/run-tests.sh`: builds a temp tree (allowed, disallowed, `~$`, dotfile, symlink), sources the collection function from the sh script, asserts counts and the diagnostics lines.
- AC2 → harness case: an unreadable file (`chmod 000`) passes through the read-error branch; assert the `READ_ERROR` log line and that no `curl` is invoked (stub `curl` on `PATH` in the harness and assert it was not called for that file).
- AC3 → harness case running the root check function against a file path.
- AC5 → `rg -n run-tests.sh scripts/loop-verify.sh` and gate output tail in evidence.

## Implementation notes
- Factor collection out of the top-level loop at `banhall-uploader.sh:195-206` into `collect_candidates <root>` that writes candidates to `$FILELIST` and skip counts to shell variables (or a small temp file), so the harness can `source` the script with a guard (`[ "${BANHALL_UPLOADER_LIB_ONLY:-0}" = 1 ] && return 0` placed after the function definitions and before the top-level flow). Keep the script POSIX-ish bash 3.2 compatible (macOS default): no associative arrays, no `mapfile`.
- Counting skips with `find`: run `find "$r" \( -type f -o -type l \)` once and classify in the `while read` loop instead of letting `find` filter silently; count `-type l` entries as `link`.
- `READ_ERROR`: wrap `sha256_of` at `:269`; empty hash means read error; log and `continue`. Match the ps1 token exactly.
- OneDrive detection on Mac: path prefix `$HOME/Library/CloudStorage/OneDrive*` or `$HOME/OneDrive*`, else `unknown`.
- Log truncation at `:259` happens after the found-count; move it above collection as in the ps1.
- Keep `README.txt` Mac notes in sync; mention `SCAN` lines once (do not duplicate the Windows section).
- Do not add the harness to `npm test`; the gate script is the runner.

## Edge cases
- Root with spaces or unicode in the path: quoting preserved (harness uses a space in the temp dir name).
- Empty folder: diagnostics with zeros.
- `shasum` absent: fall back to `openssl dgst -sha256` if already used, else `READ_ERROR`; do not crash.
- Run twice: log is truncated per run, same as today.
