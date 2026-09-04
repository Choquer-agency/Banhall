# Legacy migration evidence

Baseline: `c7075572f14e51433b524026db55d5520eddde03`. Production files are unchanged.

Original proposal suite:22 expanded cases. Migrated proposal suite:27 expanded cases. Seventeen literal test names are preserved; the unrelated-writer apply-success case is replaced by a denial and an owning-writer success. Two stopped-turn controls and two same-paragraph ambiguity controls are added. Original parameterized manager/admin access and ambiguity cases remain.

| Original literal scenario | Migrated coverage |
| --- | --- |
| allows an unrelated authenticated writer to query proposals | Same named scenario, real Convex runtime |
| rejects an anonymous proposal reader | Same named scenario, real Convex runtime |
| rejects a target copied from an unapplied candidate | Same named scenario, real Convex runtime |
| stores tool association and enforces uniqueness for a valid edit | Same named scenario, real Convex runtime |
| deduplicates repeated tool execution | Same named scenario, real Convex runtime |
| updates candidate wording without changing the canonical target | Same named scenario, real Convex runtime |
| refuses to change replacement targets | Same named scenario, real Convex runtime |
| apply updates the pinned report and complete audit tuple | Same named scenario, real Convex runtime |
| a researched V2 edit keeps its evidence session on the version checkpoint | Same named scenario, real Convex runtime |
| a missing target becomes stale and cannot be retried | Same named scenario, real Convex runtime |
| applying an already-applied proposal is idempotent | Same named scenario, real Convex runtime |
| apply preserves deletion-only replacement behavior | Same named scenario, real Convex runtime |
| apply preserves ordered replacement-list behavior | Same named scenario, real Convex runtime |
| apply allows an unrelated authenticated writer and preserves revision audit integrity | Unrelated writer denied with unchanged state; project owner passes full revision audit checks under approved report.editProse policy |
| an anonymous caller cannot apply a proposal | Same named scenario, real Convex runtime |
| an internal manager can reject a proposal | Same named scenario, real Convex runtime |
| an unrelated authenticated writer can reject a proposal | Same named scenario, real Convex runtime |
| an anonymous caller cannot reject a proposal | Same named scenario, real Convex runtime |

## Demonstrated migration adjustments

- Replace `_handler` and table-stubbing FakeDb with convex-test schema-backed transactions. The old harness omitted policy tables.
- Valid proposal creation runs during a running chat turn. Completed and aborted turns are separately asserted to refuse without mutation.
- Snapshot expectations include sourceTranscriptIds returned by the current multi-transcript contract. Existing inputs and provenance validity scenarios remain.
- All fourteen bun:test imports use Vitest. The legacy node project resolves the existing $lib alias and DOCX imports; proposal tests join the edge-runtime Convex project. No skipped tests were added.
- The approved 2026-09-01 amendment in docs/product-domain.md enforces report.editProse Own for writers (ownerId or open assignment). The old unrelated-writer apply-success expectation contradicted that policy; no production permissions were changed.

## Runs

- `bun test tests/chatProposals.test.ts`:12pass10fail before edits; bun-proposals-red.log.
- Explicit fourteen-file Bun run:88pass12fail1error before edits; bun-all-legacy-red.log.
- First migrated run exposed missing startedAt fixture field; corrected schema fixture (vitest-migrated-first.log).
- Second proposal run exposed stale ownership expectation:23pass1fail (vitest-proposals-second.log).
- `npx vitest run tests/ --maxWorkers=2`:15files131tests passed, exit0 (vitest-legacy-green.log).
- Full gate and typecheck pending root resource authorization.

- Reviewed candidate `npx vitest run tests/ --maxWorkers=2`:15 files133tests passed, exit0 (vitest-reviewed-green.log). `git diff --check` passed. Full gate/typecheck held by parent.
