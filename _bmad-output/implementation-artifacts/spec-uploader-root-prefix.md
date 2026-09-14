---
title: 'Client uploader derives the Client/Fiscal-year prefix from the chosen root in every mode'
type: 'bugfix'
created: '2026-09-09'
status: 'done'
review_loop_iteration: 1
baseline_commit: '6c4f50b2e9a5173cfa4fd635f9d63b083e26f620'
context: ['{project-root}/scripts/client-uploader/DEV-HANDOFF.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Michael (Sept 9 call, screenshot on file) double-clicked the Windows uploader with a root shaped `C:\Users\<user>\<Firm> Ltd\Production - Documents\1. Applications\<Client> Inc\2025-03-31\Submitted`; all 12 documents were rejected with `Invalid or missing ?path (expected Client/Fiscal year/…/file)`, and each rejected line shows a bare filename as the relative path. In double-click mode the script sends paths relative to the chosen root with no ancestry. Drag-and-drop would have failed too: its anchor only matches a segment named exactly `Applications`, and this corpus's folder is `1. Applications`, so it would fall back to the full absolute path and the server would label the client as "Users".

**Approach:** Both scripts derive the `Client/Fiscal year/…` prefix from the root's own absolute path in every mode, the anchor matches any segment containing "applications" (case-insensitive, last match wins), the scan summary shows the client and fiscal-year labels that will be sent before the user confirms. A root with no anchor is treated as the corpus root itself (empty prefix, the pre-existing behaviour), and the run refuses to upload, with guidance naming the folder to choose, when any path would then lack Client and Fiscal-year folders or when a folder directly under the root is itself an Applications folder. Committed fixtures and docs use placeholder names with the real folder shape. The pure helpers move into the testable libs with harness cases for both failure branches.

## Boundaries & Constraints

**Always:**
- Windows script stays PowerShell 5.1 compatible (no ternary, `??`, `?.`, `-Parallel`); Mac script stays bash 3.2 (no `declare -A`, `mapfile`, `${var,,}`).
- A root that is itself an "Applications" folder produces an empty prefix, so relative paths and the server's `local:<rel>` dedupe keys for existing corpus uploads are byte-identical to today.
- Every rejected upload keeps printing and logging the relative path and the server's error text (already true; must not regress).
- The scan summary never prints a document name, only labels and counts.
- Both harnesses (`tests/run-tests.ps1`, `tests/run-tests.sh`) stay green and gain cases.

**Ask First:**
- Any change to `convex/http.ts` or `convex/lib/ingestionClassify.ts`. The server contract is not the bug.
- Changing the no-anchor behaviour away from "empty prefix, refuse short paths" (decided by Johnny, Sept 9).
- Tightening the anchor away from "any segment containing applications" (Johnny chose to keep it loose, Sept 9).

**Never:**
- Touch `convex/_generated/`.
- Persist the prefix into `uploader-config.json` or change its shape.
- Widen the extension allowlist (CAD is a separate backlog item).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Root is the Applications folder (today's happy path) | `C:\Users\writer\Firm Ltd\Production - Documents\1. Applications`, file `Client Co\2025-03-31\Submitted\x.docx` | rel `Client Co/2025-03-31/Submitted/x.docx`, prefix empty | N/A |
| Root below the client level (Michael's screenshot shape) | root `C:\Users\writer\Firm Ltd\Production - Documents\1. Applications\Client Co\2025-03-31\Submitted`, double-click mode | rel `Client Co/2025-03-31/Submitted/x.docx`; summary line `Labels: Client Co / 2025-03-31 (12 files)` | N/A |
| Loose anchor | root `…\1. Applications\Client Co\2025-03-31` | prefix `Client Co/2025-03-31/` | N/A |
| Bracketed anchor | root `…\Applications [2024]\Client\FY2024` | prefix `Client/FY2024/` | N/A |
| Two anchors | `…\Applications\Archive\1. Applications\Client\FY2023` | last anchor wins: prefix `Client/FY2023/` | N/A |
| One-segment root | `D:\Applications` | prefix empty, anchor found | N/A |
| No anchor, root is a corpus folder | root `D:\SRED Files` holding `Client\FY2025\x.docx` | prefix empty; rel `Client/FY2025/x.docx`; labels print; upload offered (unchanged from before this fix) | N/A |
| No anchor, root below the client level | root `D:\Scans\Client\FY2025` holding `x.docx` | prefix empty; rel `x.docx` has fewer than 3 segments; prints guidance to choose the Applications folder or a client folder; stops before the upload question | Exit without uploading; log line `REFUSED` with the reason, no document name |
| No anchor, root one level above Applications | root `…\Production - Documents` whose child is `1. Applications` | first rel segment matches the anchor pattern; prints guidance naming `…\Production - Documents\1. Applications`; stops before the upload question | Exit without uploading; log line `REFUSED` |
| Dragged folder | `…\1. Applications\Client Co` dropped on the .bat | rel `Client Co/2025-03-31/Submitted/x.docx` (today: full absolute path, client "Users") | N/A |
| Bracketed folder with a matching file in the working directory (Mac) | root `/x/Applications [2024]/Client [2]/FY2024`, cwd contains a file named `Client 2` | prefix `Client [2]/FY2024/`; no glob expansion | N/A |

</frozen-after-approval>

## Code Map

- `scripts/client-uploader/banhall-uploader.ps1:258` -- `$prefix = if ($droppedMode) { Get-DropPrefix $r } else { "" }` is the bug; `:211-225` `Get-DropPrefix` with the exact `-ieq "Applications"` match at `:215`. Move the function to the lib as `Get-RootPrefix`, call it for every root. `:270` prints the found count; add the label summary after it. `:404-405` already prints/logs `REJECTED <rel> HTTP <status> <why>`.
- `scripts/client-uploader/uploader-lib.ps1` -- pure helpers dot-sourced by the harness; add `Get-RootPrefix([string]$abs)` and `Get-LabelSummary($rels)` (returns `{Label, Count}` rows for the first two segments, capped at 5, sorted by count desc then label).
- `scripts/client-uploader/banhall-uploader.sh:134-151` -- `drop_prefix` with exact `applications)` case at `:141`; `:481-482` only applies it in `DROPPED_MODE`. Rename to `root_prefix`, loosen the match, call for every root. Functions must stay above the `BANHALL_UPLOADER_LIB_ONLY` guard (`:~358`, harness asserts it). `:493` prints the count; add the label summary. `:337-341` already logs `REJECTED`.
- `scripts/client-uploader/tests/run-tests.ps1` -- `Check`/`Expect` pattern; AC6 AST cases assert one `Get-UploadCandidates` call inside `foreach ($r in $roots)` and PS 5.1 compatibility of all three .ps1 files. Add prefix and summary cases.
- `scripts/client-uploader/tests/run-tests.sh` -- `check`/`expect` pattern with `collect_candidates "$root" "$prefix"`; `case_bash32_only` greps for bash-4 constructs. Add `root_prefix` and summary cases.
- `scripts/client-uploader/README.txt`, `DEV-HANDOFF.md` -- wording says only folders inside Applications keep their labels; update to say any chosen folder under an Applications folder does.
- `convex/http.ts:49-56` -- read-only evidence: rejects rel with fewer than 2 segments. `convex/lib/ingestionClassify.ts:31-34` -- `clientName = segments[0]`, `fiscalYearLabel = segments[1]`. `convex/ingestion.ts:492-527` -- dedupe by `driveItemId = local:<rel>`, then content hash; a changed rel for an already-staged file creates a second row, hence the empty-prefix invariant above.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/client-uploader/uploader-lib.ps1` -- add `Get-RootPrefix` (loose, last-match anchor; empty prefix when no anchor), `Get-LabelSummary`, and a pure pre-upload check that returns the refusal reason (short rels, or first rel segment matches the anchor pattern) -- make the logic testable without WinForms.
- [x] `scripts/client-uploader/banhall-uploader.ps1` -- delete `Get-DropPrefix`; compute `$prefix = Get-RootPrefix $r` for every root; print and log `Labels:` lines after the found count; on a refusal reason print guidance, log `REFUSED`, and exit before the upload question -- fixes the 400 and shows the user what will be labelled before `y`.
- [x] `scripts/client-uploader/banhall-uploader.sh` -- rename `drop_prefix` to `root_prefix` (empty when no anchor), loosen the anchor with a `*applications*` case pattern, apply in every mode, add `label_summary`, the pre-upload check and the refusal -- Mac parity.
- [x] `scripts/client-uploader/tests/run-tests.ps1` -- cases for each I/O row plus the summary cap and ordering; keep AC6 shape cases passing.
- [x] `scripts/client-uploader/tests/run-tests.sh` -- same cases in bash; keep `case_bash32_only` and `case_lib_guard` passing.
- [x] `scripts/client-uploader/README.txt`, `scripts/client-uploader/DEV-HANDOFF.md` -- update the root guidance sentences.

**Acceptance Criteria:**
- Given the Windows harness, when it runs `Get-RootPrefix` on each path in the I/O matrix, then it returns the listed prefix.
- Given the bash harness, when it runs `root_prefix` on each path in the I/O matrix, then it returns the listed prefix.
- Given a root deeper than the client level in double-click mode, when the scan finishes, then every candidate rel has at least three segments and the `Labels:` summary names the client and fiscal-year folder with the file count.
- Given a root with no anchor whose files all have Client and Fiscal-year folders, when the scan finishes, then labels print and the run offers to upload exactly as before this fix.
- Given a root with no anchor where any file would lack those folders, or whose first-level child is itself an Applications folder, when the scan finishes, then guidance names the folder to choose and the run exits before asking to upload.
- Given `bash scripts/loop-verify.sh`, when it runs, then every numbered step passes including both uploader harnesses.
- Given the screenshot-shaped root `C:\Users\writer\Firm Ltd\Production - Documents\1. Applications\Client Co\2025-03-31\Submitted` as a harness fixture on both platforms, when the prefix helper runs on it, then it returns `Client Co/2025-03-31/Submitted/`. No real person or client name appears in committed fixtures or docs.
- Given the Windows harness, when it parses the uploader's AST, then the `$rel` assignment inside the roots loop has a right-hand side that begins with `$prefix +`.
- Given a scan that prints labels, a warning, or a refusal, when it writes `upload-log.txt`, then the same lines appear there as `LABELS`, `WARN` or `REFUSED` records with no document name.

## Spec Change Log

- 2026-09-09, loop 1. Trigger: all three reviewers flagged that the full-path fallback for a no-anchor root regresses remembered corpus roots not named Applications (correct labels become client "Users" with new dedupe keys), and that the loose anchor over-captures a client folder containing "applications". Johnny decided: keep the loose anchor (documented risk), change no-anchor to empty prefix plus refusal when paths are too short or the root sits one level above an Applications folder, and anonymize fixtures. Amended: Approach, Ask First, I/O matrix (new rows, real names replaced), tasks, acceptance criteria. Known-bad state avoided: silent mislabelled duplicates in the review queue. KEEP: `Get-RootSegments`/`Get-RootAnchorIndex`/`Get-RootPrefix` and the bash trio, `Get-LabelSummary`/`label_summary` with the fixed missing-folders bucket, the AST-style wiring tests, the README and DEV-HANDOFF structure. Patches bundled with this loop (not spec changes): bash `set -f` around the segment loop with restore, `@()` around `Get-RootSegments` in both callers, `$rel` AST assertion, log label and warning lines, "and N more" tail past five labels, `LC_ALL=C` on the bash sort and empty-field skip in awk, loose match in both auto-detect probes, comment and DEV-HANDOFF wording (server rejects one segment and accepts two; `Applications [2024]` is a corpus-root name, not a client folder).
- 2026-09-09, loop 2. Trigger: review of loop 1 found no spec-level gaps; patch-level items only. Patch-level generalization of the frozen "folder directly under the root is itself an Applications folder" rule: the pre-upload check now refuses when the anchor pattern matches ANY folder segment of a rel (never the file name), so a root two or more levels above the Applications folder is refused too, and the guidance lists every matching Applications folder by full path. The frozen matrix rows remain true as stated (one level above is the special case). Other patches bundled: rel segments counted like the server's `sanitizeRelPath`; drive letter dropped only as the first segment; a file name containing "applications" is never treated as a child folder; LABELS log records carry the bare payload; probes lifted into `Get-ApplicationsGuess` / `guess_applications_root` (exact wins, loose fallback); named five-row cap; both harnesses execute the uploader main path in folder-argument mode with stdin closed, which surfaced and fixed the `Read-Host` closed-stdin fall-through (`"$answer"` coercion); server description corrected (two-segment rels are accepted but classify with no fiscal year); README and DEV-HANDOFF wording per review.

## Design Notes

Deferred, not this story: files previously drag-dropped from a loosely named Applications folder carry full-path dedupe keys and will re-stage once under their correct keys; a server-side content-hash dedupe across keys would absorb that. A kit version marker in the first log line would let the dev team tell which prefix logic produced a given upload. Under an anchored root, a file sitting directly in a client folder (two-segment rel) is accepted by the server and lands as docKind "unknown" with no fiscal year; that is pre-existing and stays a per-file outcome rather than a batch refusal. Reviewers also noted that the loose anchor lets a client folder containing "applications" steal the anchor; Johnny chose to keep the loose match on Sept 9, so this is a documented risk, not a defect.

Michael's corpus is a SharePoint document library synced to `C:\Users\<user>\Banhall Consulting Ltd\Production - Documents\`, not a folder named `OneDrive…`. The auto-detect probe only searches `$env:OneDrive*` and `$HOME\OneDrive*`, so it will never offer this root and the user always picks manually. Out of scope here; recorded so the follow-up is obvious.

## Verification

**Commands:**
- `pwsh -NoProfile -File scripts/client-uploader/tests/run-tests.ps1` -- expected: `N passed, 0 failed`, N greater than today's count
- `bash scripts/client-uploader/tests/run-tests.sh` -- expected: `N passed, 0 failed`, N greater than today's count
- `bash scripts/loop-verify.sh` -- expected: all steps pass

**Manual checks (if no CLI):**
- Johnny reproduces on a Windows machine with a OneDrive folder shaped like Michael's pasted path, first on main (expect the 400s) then on this branch (expect uploads and a correct `Labels:` line).

## Suggested Review Order

**Prefix derivation (the fix)**

- Every root, every mode, now gets its ancestry prefix; this one line was the Sept 9 bug
  [`banhall-uploader.ps1:250`](../../scripts/client-uploader/banhall-uploader.ps1#L250)

- Loose "applications" anchor, last match wins, per Johnny's decision; no-anchor yields empty prefix
  [`uploader-lib.ps1:91`](../../scripts/client-uploader/uploader-lib.ps1#L91)

- Prefix built from segments after the anchor; empty for the Applications folder itself keeps dedupe keys stable
  [`uploader-lib.ps1:111`](../../scripts/client-uploader/uploader-lib.ps1#L111)

- Mac twin, with globbing switched off around the IFS split so bracketed folder names survive
  [`banhall-uploader.sh:135`](../../scripts/client-uploader/banhall-uploader.sh#L135)

- Mac call site applies the prefix in every mode
  [`banhall-uploader.sh:657`](../../scripts/client-uploader/banhall-uploader.sh#L657)

**Pre-upload refusal (no-anchor roots)**

- Pure check: folder segment matching the anchor wins over short rels; never names a document
  [`uploader-lib.ps1:205`](../../scripts/client-uploader/uploader-lib.ps1#L205)

- Segments counted the way the server's sanitizeRelPath does
  [`uploader-lib.ps1:125`](../../scripts/client-uploader/uploader-lib.ps1#L125)

- Windows wiring: check only runs for roots with no anchor
  [`banhall-uploader.ps1:262`](../../scripts/client-uploader/banhall-uploader.ps1#L262)

- Refusal prints guidance, logs REFUSED, exits before the upload question
  [`banhall-uploader.ps1:287`](../../scripts/client-uploader/banhall-uploader.ps1#L287)

- Mac check via awk with the root passed through ENVIRON so backslashes survive
  [`banhall-uploader.sh:235`](../../scripts/client-uploader/banhall-uploader.sh#L235)

- Mac wiring slices the file list per root so one root's rels never judge another
  [`banhall-uploader.sh:659`](../../scripts/client-uploader/banhall-uploader.sh#L659)

**Labels summary and logging**

- Tally of Client / Fiscal year pairs, capped, missing-folder bucket carries no file name
  [`uploader-lib.ps1:148`](../../scripts/client-uploader/uploader-lib.ps1#L148)

- Mac labels read via process substitution, not a pipe, so log flags reach the parent shell
  [`banhall-uploader.sh:687`](../../scripts/client-uploader/banhall-uploader.sh#L687)

**Closed-stdin safety (incidental, pre-existing)**

- Read-Host returns null on closed stdin and null -notmatch is falsy, so a closed stdin used to fall through to uploading; coerced to string
  [`banhall-uploader.ps1:348`](../../scripts/client-uploader/banhall-uploader.ps1#L348)

- Same coercion on the all-or-test branch, where the fall-through meant uploading everything
  [`banhall-uploader.ps1:338`](../../scripts/client-uploader/banhall-uploader.ps1#L338)

**Auto-detect probe**

- Exact "Applications" preferred, loose match as fallback, so "1. Applications" is offered
  [`uploader-lib.ps1:257`](../../scripts/client-uploader/uploader-lib.ps1#L257)

**Tests**

- Windows matrix fixtures in the screenshot's shape under placeholder names
  [`run-tests.ps1:284`](../../scripts/client-uploader/tests/run-tests.ps1#L284)

- Executed runs of the real Windows uploader in drop mode: refused, warned, above-Applications, anchored stray
  [`run-tests.ps1:705`](../../scripts/client-uploader/tests/run-tests.ps1#L705)

- AST assertion that the rel is composed from the prefix inside the roots loop
  [`run-tests.ps1:828`](../../scripts/client-uploader/tests/run-tests.ps1#L828)

- Mac glob-expansion fixture plants a matching file in the working directory
  [`run-tests.sh:304`](../../scripts/client-uploader/tests/run-tests.sh#L304)

- Executed runs of the real Mac uploader against a throwaway kit
  [`run-tests.sh:577`](../../scripts/client-uploader/tests/run-tests.sh#L577)

**Docs**

- Hand-off note: mechanism, dedupe invariant, operator note on re-staged duplicates
  [`DEV-HANDOFF.md:98`](../../scripts/client-uploader/DEV-HANDOFF.md#L98)

- Client-facing: Labels step, what to do when they look wrong, SharePoint-shaped example
  [`README.txt:23`](../../scripts/client-uploader/README.txt#L23)
