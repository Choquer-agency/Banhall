# Analyzer provenance repair evidence

Status: implementation and independent review complete. Local commit pending at evidence authoring; no shipping claim.

Baseline: `9da55bece5948da12129720dd2330a3032c985bf`. All implementation and evidence belong to this isolated worktree. The initial review target is preserved in review.diff. Final production/test bytes are immutably identified in verified-source-sha256.tsv and included in the local completion commit.

## Reproduction and correction

Before editing production, added the analyzer routing regression in `tests/aiUsage.test.ts` and ran:

`npx vitest run --project convex tests/aiUsage.test.ts -t 'analyzer routing discloses'`

Exit 1: 1 failed, 12 intentionally filtered tests skipped. The failure shows the old candidate-only descriptor versus the expected compare/single/iterative/legacy declaration. Raw output: [baseline-failure.log](baseline-failure.log).

After correcting only `calls.analyzer.model`, the focused suite passed 4 files / 70 tests. Raw initial output: [focused.log](focused.log). Final output after extra per-branch hash mutations and descriptor assertions: [focused-final.log](focused-final.log).

## Acceptance map

| Criterion or matrix row | Evidence |
| --- | --- |
| Compare fixed MODEL, both pair orders | `pipeline.compare.test.ts` parameterized real entry/candidate test compares actual analyzer model with MODEL and manifest compare modelId |
| Single selected model | Existing real single entry and candidate test retains opus selection, asserts single descriptor |
| Iterative selected model | New real startIterativeGeneration action test retains opus selection, asserts iterative descriptor |
| Legacy candidate fallback | Real generateCandidate without analysis uses original candidate model and asserts legacy descriptor |
| Corrected hash differs | New aiUsage regression constructs previous candidate-only descriptor and compares real canonical hashes |
| Every analyzer routing branch is hashed | Four additional mutations in existing hash-sensitivity test |
| Legacy provenance remains compatible | Existing generationAttribution suite included in focused and full runs |
| Runtime policy unchanged | Production diff contains only analyzer descriptor in promptProgram.ts; pipeline.ts and iterative.ts are unchanged |
| No generated edits | `git diff --exit-code -- convex/_generated` |

## Gates and dependency ownership

`npm ci` completed with exit 0 in this worktree; [install.log](install.log). No dependency versions or lockfile changed. [dependency-proof.log](dependency-proof.log) records full HEAD, worktree-local Vitest resolution and version.

- `npm test`: exit 0, 148 files, 1732 tests passed; [full-test.log](full-test.log).
- `PUBLIC_CONVEX_URL=http://localhost npm run check`: zero errors and warnings; [check-final.log](check-final.log).
- `npx tsc --noEmit -p convex`: [convex-tsc-final.log](convex-tsc-final.log).
- Final focused suite, typecheck, backend types, whitespace and generated-file checks have explicit exit records in [gate-exits.tsv](gate-exits.tsv).

No frontend component changes, so no component/browser run. Stubbed provider transport only, no live model calls. The factory umbrella also includes unrelated uploader harnesses; this repair runs the declared BMAD scope gates above.

## Historical review handoff

Step-03 implementation delegation failed because the agent thread limit was reached, so its documented inline fallback was used. Root instructed this task to preserve all three exact expanded review prompts and return REVIEW-PENDING to release capacity. Do not mark the spec done until all reviewers are dispatched and returned, findings triaged, patches verified and a local commit created.

The snapshot diff includes all changed tracked files, the new spec and all audit evidence except the diff/prompts themselves (to avoid recursive self-inclusion). No ledger, native operation state, historical story, other worktree, generated file or active integration was edited.


## Completed review and final verification

All three independent Astra medium reviewers returned before triage. Edge-case and verification-gap results were empty. Blind review produced ten findings: three low patches (distinct legacy candidate coverage, iterative successful initialization proof, immutable source fingerprint) and seven rejected broader coverage requests. Full independent rationale: [review-triage.md](review-triage.md). No deferred items or ledger changes. No runtime policy edits.

Final focused suite: 4 files, 71 tests passed ([review-focused.log](review-focused.log)). Final full suite: 148 files, 1733 tests passed ([review-full-test.log](review-full-test.log)). Svelte check found zero errors/warnings; Convex tsc, whitespace and generated-file checks all passed. Each command exit is recorded in [review-gate-exits.tsv](review-gate-exits.tsv).

[verified-source-sha256.tsv](verified-source-sha256.tsv) identifies the exact three implementation/test files hashed immediately before final gates. To reproduce the fingerprint check from the completion commit, run from the worktree root:

```python
from pathlib import Path
import hashlib
for line in Path(".audit/analyzer-provenance-repair/verified-source-sha256.tsv").read_text().splitlines():
    expected, filename = line.split("\t")
    assert hashlib.sha256(Path(filename).read_bytes()).hexdigest() == expected, filename
```

The coordinating task receives the full completion commit SHA and the post-commit fingerprint verification result. The commit itself contains these immutable source bytes and gate records, avoiding a self-referential commit SHA inside its own contents.

## Raw artifact whitespace

The precommit staged all-file whitespace check reports blank final log lines and diff-context spaces inside the verbatim review snapshot/prompts. Those are preserved raw evidence, not source defects. The source/spec whitespace check passes. The earlier recorded whitespace gates ran before ignored raw artifacts were staged; they should not be read as claiming that raw embedded diff text satisfies source whitespace conventions.
