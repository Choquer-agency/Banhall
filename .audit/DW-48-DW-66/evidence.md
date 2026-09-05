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
