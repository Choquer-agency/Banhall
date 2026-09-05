# DW-48 / DW-66 execution evidence

Baseline commit: `f34bd79ccff35019c5cf5460d8845a0240c19978`.
Exact implementation commit: `6c6cb7023417b38d0b8aee09a34dc4fe26d6cec3`. The following artifact commit records final native build-auto evidence; run acceptance remains the orchestrator’s responsibility. Baseline production hashes are retained in `baseline.txt`.

## Acceptance criteria

| Acceptance criterion | Executed proof |
| --- | --- |
| Malformed baseline/current content skips persistence while public operations complete | `convex/reportEditDistance.test.ts`, `malformed content persistence boundary`, 16 malformed cases across public milestone and client publish. Each drains scheduled work, checks stored milestone snapshot or published project fields, then asserts no persisted scalar. |
| Empty and edited documents retain formula and read-time contract | Same suite, 10 valid cases across both triggers: empty current, empty baseline, both empty, empty paragraph, edited content. Checks PED 1, 0, or 0.52 and read query keys/parity. Existing formula suite and baseline/dedupe/attribution tests also pass. |
| Baseline demonstrates bogus PED 1 and PED 0 | `red.log`: 16 failures, received `[1]` for one broken side and `[0]` for both broken. The production files had no edits when this command ran. The 10 valid cases already passed. |
| Extraction distinguishes empty success/failure while preserving legacy fallback | `tests/reportEdits.test.ts`, `plain text extraction outcomes`: empty root/paragraphs, syntax/null/non-array/nested failures, inline joining/nested blocks/horizontal rules. |

## Commands and actual results

Before production edits:

```text
npx vitest run convex/reportEditDistance.test.ts -t 'malformed content persistence boundary'
Exit 1
Test Files  1 failed (1)
Tests  16 failed | 10 passed | 24 skipped (50)
```

Complete output: `red.log`.

After the fix:

```text
npx vitest run convex/reportEditDistance.test.ts convex/lib/editDistance.test.ts tests/reportEdits.test.ts
Exit 0
Test Files  3 passed (3)
Tests  76 passed (76)
```

Complete output: `green.log`.

Ordinary full gate:

```text
bash scripts/loop-verify.sh
Exit 0
svelte-check found 0 errors and 0 warnings
Test Files  148 passed (148)
Tests  1835 passed (1835)
50 passed, 0 failed
18 passed, 0 failed
```

Complete output: `full-gate.log`, including uploader harness assertions. Convex TypeScript check is the first command and passed silently. `git diff --check` also exited 0; command result is retained in `diff-check.log`.

## Scope and limitations

Only the extraction outcome and persistence boundary changed in production. The existing traversal, read-time fallback, PED formula, baseline selection, deduplication, and attribution are preserved. This is not full Tiptap schema validation: the same traversable values accepted by the legacy extractor remain accepted. No historical readings are backfilled. No policy, generated files, deferred ledger, native state, or historical story was changed; no push or deploy was performed.

No `agent-transcripts/` directory is available in this worktree. The audit records observable command output and file references; chronological red-before-edit evidence also appears in this agent conversation.


## Audit-trail review

A separate review agent was requested on `gpt-5.6-sol`. It confirmed the referenced baseline hashes, all test counts, and scope. It flagged that without an available transcript, retained files cannot independently bind the baseline production bytes to the red run; the parent conversation retains the tool-call chronology. Baseline hashes were recorded after the red run and are explicitly baseline commit hashes, not a captured pre-run working-tree attestation. A second flag about the missing retained diff-check output was resolved by recording a fresh command result in `diff-check.log`.


## Parent verification after implementation handoff

The parent directly reran the same spec commands after implementation returned. Exit statuses were observed by the parent and reported during review; retained output confirms the counts:

| Artifact | Command | Result |
| --- | --- | --- |
| `parent-focused.log` | `npx vitest run convex/reportEditDistance.test.ts convex/lib/editDistance.test.ts tests/reportEdits.test.ts` | Exit 0; 3 files and 76 tests passed. |
| `parent-full-gate.log` | `bash scripts/loop-verify.sh` | Exit 0; 148 files and 1835 tests passed; zero Svelte errors/warnings; uploader harnesses 50 and 18 passed, zero failures. |

The review patches clarify the helper comment and baseline provenance, and inventory these parent-run artifacts. They change no executable behavior.


## Verification after review patches

Both spec commands were rerun after applying all three review patches:

| Artifact | Command | Result |
| --- | --- | --- |
| `patch-focused.log` | `npx vitest run convex/reportEditDistance.test.ts convex/lib/editDistance.test.ts tests/reportEdits.test.ts` | Exit 0; 3 files and 76 tests passed. |
| `patch-full-gate.log` | `bash scripts/loop-verify.sh` | Exit 0; 148 files and 1835 tests passed; zero Svelte errors/warnings; uploader harnesses 50 and 18 passed, zero failures. |

The implementer directly observed both exit statuses. `git diff --check` also passed after the comment and provenance changes. No commit or ledger change was made during these patches.

## Final preservation check

Deferred-work ledger Git blob remained `a7fd4e71b44092d51fbc5da2df98457e5fe3b4ee` before and after implementation/review. No ledger bytes were staged. Four code/test files are committed at the implementation revision above. Independent review decisions are retained in `review.md`.

## Fresh review and native finalization, 2026-09-04

Reviewed source HEAD: `0a52e0ab50a259e86c70dc5c3472dbabfbf9882d`. Production files were unchanged during this follow-up. The parent directly ran both spec commands and observed exit 0: `npx vitest run convex/reportEditDistance.test.ts convex/lib/editDistance.test.ts tests/reportEdits.test.ts` (76 tests, `followup-focused.log`) and `bash scripts/loop-verify.sh` (1835 tests, zero Svelte diagnostics, uploader harnesses 50 and 18 passes, `followup-full-gate.log`).

The earlier preservation check describes the implementation session. This review invocation already contained native ledger closure bytes with Git blob `4a044b3a4c95a8993b403729ab9188cc2f5940de`. Native journal event `sweep-bundle-closed` identifies this bundle and DW-48/DW-66; the following review dispatch establishes ordering. `native-finalization.json` retains the exact closure event, journal source, invocation digest, and staged-byte checks. The agent did not author or alter ledger content. Staging these exact native bytes is authorized by AGENTS.md Native BMAD ledger finalization. This commit does not establish final native run acceptance. sprint-status.yaml was not written or reverted.

Four fresh review layers found no required production changes. One low documentation patch records native provenance; twelve findings were rejected with reasons in `followup-review.md`. No deferrals or intent/spec gaps. Follow-up score 1, recommendation false.
