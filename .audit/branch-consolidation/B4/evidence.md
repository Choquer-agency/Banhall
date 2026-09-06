# B4 implementation evidence

Baseline: `d11195e5fdf6fb40baf27cacff86eaad6bf69ef6`, matching the dispatched spec. The spec and its sole frontmatter context file, `AGENTS.md`, were read fully before implementation; `.factory/AGENTS.factory.md` and planning/B4.md were also read. The spec takes precedence for worker scope. No installs, staging, commits, reviews, remotes, other-worktree writes, canonical configuration edits, generated-file edits, or native-state/ledger mutations were performed.

## Change and source identity

Deleted exactly the 17 files in `allowlist.json`, totaling 1,316 lines. `source-manifest.json` records each original SHA-256; `baseline-hashes.json` records all tracked file identities; `baseline.txt` records HEAD and initial status. The input spec was already untracked and remains untouched. `provenance.json` records comparisons to the two historical deletion parents. `deletion.diff` is the exact source diff. `comparison.json` confirms the 17 deletions and 5,416 other tracked files byte-identical, including retained tests, current comments, current Editor and prior batches. The index is unchanged. Evidence lives in this ignored audit directory and has not been staged.

## No-caller proof

`source-references-before.txt` and `source-references-after.txt` contain whole-word filename stem and exported helper symbol searches across src, tests, shared and convex. `resolved-reference-inventory.json` resolves quoted relative and $lib paths, including extensionless references, against the allowlist: seven edges, all originating inside deleted islands. `dynamic-barrel-before.txt` and `dynamic-barrel-after.txt` capture dynamic imports, require calls, glob candidates and export-from candidates. Inspection found literal dynamic imports of document parsers, file-saver and exportTemplateDocx only, with no glob loading of these islands. Symbol searches also cover multiline barrels and renamed imports through their path text. No current production caller resolves through any deleted file.

Remaining whole-word Header matches are comments, test fixture text, Calendar/RangeCalendar members or the distinct drawer-header.svelte barrel. They do not refer to ui/Header.svelte. `docs-references-before.txt` records directly stale references at docs/design-system.md:403 (MyWorkGroup) and docs/svelte-migration.md:77 (ui/Header and ui/MenuToggleIcon). Documentation cleanup is reserved for B9. The broad raw search is in `references-before.txt`; it includes unrelated historical and vendor matches and is not treated as a live-caller inventory.

## Executable verification

`retained-commands.json` contains the three exact spec commands. `run-proof.py before` and `run-proof.py after` executed them without alterations. All six commands exited 0. The same selections were additionally run with JSON reporting to capture actual runtime case identities and statuses; all supplemental runs exited 0. Exact commands, timestamps and exits are in `commands.jsonl`; complete stdout/stderr is in the corresponding logs.

| Identical selection | Before | After |
| --- | --- | --- |
| 10 project/editor/recovery/UI component files | 42 passed | 42 passed |
| 5 My Work/Home component files | 19 passed | 19 passed |
| 2 retained helper unit files | 5 passed | 5 passed |

`retained-case-parity.json` records the 66 identical runtime case names and passing statuses. `before-cases-*.json` and `after-cases-*.json` retain original Vitest results. No assertions or retained suites were changed or skipped. Browser suites ran in the existing local headless Chromium runtime. No tracked historical screenshot changed, so no screenshot restoration was necessary.

Before deleting, separately executed the retired suites and captured actual runtime names: MyWorkRow.component.test.ts 3 passed, laneSort.test.ts 9 passed, myWorkPreferences.test.ts 4 passed. Full results are in `retired-component.json` and `retired-unit.json`; they explain exactly 16 intentionally retired cases and are excluded from both retained selections.

Both unchanged Vitest configurations were listed before and after using `node node_modules/vitest/vitest.mjs list --filesOnly --json=<receipt> --config <config>`. Unique discovered files decreased from 217 to 214, with exactly the three authorized deleted suite paths removed and no added files. The component configuration has a repeated pointer suite across browser projects, so raw listing entries are not unique file totals. `compare-proof.py` compared actual discovery against tracked membership minus exactly the three deletions and the same three historical archives named by the canonical guard. No retained tracked orphan exists. This is an unstaged membership check, not a claim that the staged canonical guard ran.

`python3 .audit/branch-consolidation/B4/compare-proof.py` exited 0 and wrote `comparison.json`. It checks case parity, exact diff membership, all other tracked hashes, discovery changes, retained orphan absence and unchanged index, and invokes `git diff --check`, which exited 0. Re-run that script to validate the receipts against current source bytes.

## Acceptance and handoff limits

- Import isolation: source/path/export/dynamic inventory above finds no live callers.
- Retained behavior: identical 15 component files and two unit files pass, with identical 66 runtime cases.
- Exact authorization: only 17 allowlisted tracked paths differ, all deletions; every other tracked file retains its baseline SHA-256.
- Test-count accounting: exactly three suites and 16 retired runtime cases, with discovery and case receipts.

Worker implementation is complete. Per spec, parent still owns fresh review, staged canonical discovery, `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` on combined source, final admission and shipping. These were not run by this worker. Documentation cleanup remains B9 scope. Existing Editor tests exercise rendering, replacement and decorations; projectRoute covers loading/cohort wiring and imports. There is no direct CommentOverlay/CommentInput add/resolve interaction suite, and no full comment lifecycle or authenticated end-to-end coverage is claimed.

## Parent acceptance

All three fresh review layers completed. Parent applied evidence-only clarifications in review-evidence-addendum.md, reran compare-proof.py successfully before staging, and completed both full gates. The first gate used Node22 (gate/result.json); authoritative repository Node24.19.0/npm11.17.0 gate is gate-node24/result.json, log hash1e070fdbd14f4056137befac82e06bd581071286d798689cf435736a9aa844ce. Both passed2015 unit and478 browser tests plus types, build, discovery and50+18 harness assertions. Lower counts match13 retired unit cases and3 retired component cases. Both runs verified tracked source and saved/restored9 known historical captures. Parent gate helper now refuses non-24 Node and records executable identities. B9 documentation remains required before final combined admission.
