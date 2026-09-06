# Q2 direct verification evidence

Candidate HEAD: `31ca9c3ba0b22e24da853ae763592d87bd71cc85`. The spec and its full frontmatter context were read before implementation. The spec overrides general factory intake, baseline rerun, install and shipping instructions for this bounded repair.

## Changes and source preservation

Only `AGENTS.md`, `src/lib/components/chat/OptimisticSend.component.test.ts` and `src/routes/admin/learning/LearningHealth.component.test.ts` changed. The two writers contain only 13 destination-prefix replacements, preserving all 14 names (including both Retry variants), four-level relative paths, subdirectories, screenshot options, assertions and test selection. AGENTS changes only the historical restoration bullet. See `candidate.diff`, `original-sources.json`, `source-fingerprints.json` and `source-preservation.json`.

## Before condition

The provided baseline result recorded exit 0 and eight restored historical PNGs. Its full gate log was read and its SHA-256 verified against `baseline/result.json`: `d42b08ff6afe1fb550a73dbd53e4bb9e790b05901f196666b2c12c7dabb12633`. This is prior restoration evidence, not a clean direct-run proof or a new baseline execution. The actual restored paths were:

- `.audit/DW-98-fix/implicit-A-retained.png`
- `.audit/published-status-fix/published-after.png`
- `.audit/story-7/optimistic-after.png`
- `.audit/story-7/optimistic-scrolled-after.png`
- `.audit/story-7/retry-highlight-only.png`
- `.audit/story-7/retry-text-and-highlight.png`
- `.audit/story-7/second-overflow-after.png`
- `.audit/story-8/learning-sources-mobile-after.png`

## Acceptance evidence

- Three-file scope and preservation: `candidate.diff` and `source-preservation.json`; `git diff --check` exited 0 (`diff-check.txt` is empty).
- Direct canonical gate: `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, exit 0, 162.173 seconds. Full output: `gate.log`; exit: `gate-exit.txt`; nanosecond wall-clock bounds: `run-start-ns.txt` and `run-end-ns.txt`. Log SHA-256: `e0119f6aae20d706b20b21477178493d42686dd45a3e028862af8304f9e3fca3`. No install, restoration, gate wrapper or configuration change was used.
- Candidate preservation: `before-tracked.z` / `after-tracked.z` retain NUL-delimited inventories; `before-tracked.json` / `after-tracked.json` retain SHA-256 hashes, filesystem types and modes, including symlink targets and missing states. All 6366 paths were unchanged, including 3068 historical `.audit/` paths. The inventory reflects the actual candidate, independently of the older baseline count of 6,317.
- Git state preservation: raw `before-status.z` / `after-status.z` and `before-index.z` / `after-index.z` are identical. The pre-existing untracked spec also retained identical bytes (`before-spec.json` / `after-spec.json`).
- Capture production: `destinations.json`, `before-captures.json`, `after-captures.json` and `fresh-output-inventory.json` independently show all 14 destinations are nonempty PNGs, have modification times within the run, and are ignored by their actual `git check-ignore -v` rules. Before-run state and hashes are retained when present.

## Gate results

All nine steps passed. Svelte check: 0 errors, 0 warnings. Unit tests: 154 files, 2,038 tests passed. Discovery guard passed. Production build passed. PowerShell uploader: 50 passed, 0 failed (the existing platform-specific dotfile sub-case reports SKIP); Bash uploader: 18 passed, 0 failed. Browser component suite: 63 files, 489 tests passed.

## Limits and handoff

No implementation acceptance item remains incomplete. Existing build/browser warnings (buffer externalization, chunk sizing and Svelte warnings) also occur in the baseline; they were not changed by this path-only repair. No source, historical evidence, native/factory state or ledger was restored or rewritten by verification. No staging, commit, push or merge was performed. Parent retains final review, acceptance and shipping. The spec remains unchanged.

## Root evidence location

All evidence paths above are under direct-verification/. Root independently compared before/after inventories, working hashes, Git status/index and bound gate log, and verified both writer files equal HEAD with only the exact destination-prefix substitution. Three independent review layers remain pending.

## Root review qualifications and retained evidence

The three-file limit applies to implementation files; the SPEC and owned audit package are additional review/shipping artifacts. The user selected BMAD and authorized verified remaining fixes and eventual commit/push/normal merge; workers remain prohibited from shipping. This standing authorization, not a spec granting itself authority, controls the generic factory workflow exceptions.

Before/after evidence establishes byte/state equality, not a filesystem write-event trace. No restoration command was used. No claim is made that equal-byte incidental writes were monitored. The recorded untracked inventory contains only this unit's SPEC, whose bytes were separately compared; ignored historical/raw audit files are outside this tracked-source guarantee. The canonical task trail remains .audit/quality-pass/decisions.tsv; worker-local logs document their bounded executions.

Fourteen current PNGs were copied byte-for-byte into verified-pngs/ and bound in retained-png-proof.json. Root checked every PNG chunk CRC, fully decompressed IDAT, verified dimensions/scanline length/filter tags and matched original capture hashes. These are unchanged screenshots from existing asserted scenarios; no new visual design was made and no visual quality claim is inferred merely from PNG validity. Retained copies are immutable evidence; normal ignored outputs intentionally remain latest-run files. During this gate, Q2 was the only writer/test runner in the owned checkout; root and other auditors performed read-only work or wrote separate ignored audit paths.

The new AGENTS artifact guidance was moved outside the generated context block after review so a refresh preserves it. This documentation-only placement change does not alter the tested screenshot writer code. Current gate/CI does not add a permanent filesystem preservation guard; this unit proves the literal repair through the actual canonical run and preserved byte evidence, with no new test mirroring path constants.

All raw artifact names in this report resolve under .audit/quality-pass/Q2/direct-verification/ unless another root-relative path is explicitly shown. Committed archive-manifest.json maps compressed storage paths to original paths and binds every admitted artifact.

Root acceptance: all review findings resolved as recorded in review-triage.md. The direct gate result remains valid for unchanged screenshot writer code; SPEC/evidence clarification and documentation placement are subsequent non-runtime changes. final-source-hashes.json binds final source/SPEC. No repository enforcement guard was added.
