---
key: transcripts-6-provenance-sets
status: done
kind: feature
deps: [transcripts-2-generation-reads-all]
touches: [convex]
risky: [provenance]
verify: [npx vitest run convex/lib/snapshots.test.ts convex/reports.test.ts convex/generationAttribution.test.ts convex/projects.test.ts]
done_when: ["rg -q 'sourceTranscriptIds' convex/generations.ts convex/reports.ts convex/lib/snapshots.ts convex/projects.ts", test -f convex/lib/snapshots.test.ts, test -f convex/reports.test.ts, "rg -q 'sourceTranscriptIds' convex/lib/snapshots.test.ts", npx vitest run convex/lib/snapshots.test.ts convex/reports.test.ts]
title: "Reports, snapshots and provenance rows record the set of transcripts beside sourceTranscriptId"
plan: 20260903-client-sync
updated: "2026-09-04T08:23:41.291Z"
run: 20260904-080505-transcripts-6-provenance
branch: factory/transcripts-6-provenance-sets
escalation: implementer session failed (attempt 2); log .factory/runs/20260903-211917-12-tickets/logs/transcripts-6-provenance-sets.implement-2.jsonl
ui: false
merged: a26a457
verdict: test-verified
evidence: .audit/transcripts-6-provenance-sets/evidence.md
deferred: ["tests/snapshots.test.ts still asserts the pre-widen snapshotAuditFields shape with toEqual and would fail if bun tests were ever wired into a gate; the ticket says leave it as is and it is unreachable from every npm script (vitest.config.ts:19)"]
---
## Intent
Old readers keep `sourceTranscriptId` (first transcript). New readers get `sourceTranscriptIds` on reports, snapshots and provenance rows, written at every site that writes the single id today, and carried through snapshot audit fields and citation review. Nothing existing is invalidated; lineage rules for the single id stay as they are. The proof lives in files the gate runs: `vitest.config.ts:19` includes only `convex/**/*.test.ts` and `tests/aiUsage.test.ts`; every other file under `tests/` imports `bun:test` and is outside the gate.

## Acceptance
- AC1: Given a completed generation with transcripts [a, b], when the report and its `generated` snapshot are created (`generations.ts:928`, `:941`), then both carry `sourceTranscriptId: a` and `sourceTranscriptIds: [a, b]`; same for the candidate-selection snapshot (`:994`) and the iterative ghost snapshot (`:2018`).
- AC2: Given `createProvenance` called with `sourceTranscriptIds`, then the row stores them and `reviewClaimCitation` copies them to the successor row (`reports.ts:124`, `:195`).
- AC3: Given `snapshotAuditFields` with a generation that has `transcriptIds`, then the returned fields include `sourceTranscriptIds` from that generation; with a legacy generation (only `transcriptId`), `sourceTranscriptIds` is `[transcriptId]`; with no generation, the explicit `sourceTranscriptIds` passed in, filtered to the project, else absent. The existing single-id conflict rules (`lib/snapshots.ts:99-113`) are unchanged and still pinned.
- AC4: Given a duplicated project (`projects.ts:841-843`), the copied report carries `sourceTranscriptIds: [targetTranscriptId]`.
- AC5: Snapshot dedupe (`snapshots.ts:180`) and restore (`:289-305`) carry the list alongside the single id.

## Verification
- AC1 → `convex/generationAttribution.test.ts` (or `generationRecovery.test.ts`) case completing a generation seeded with two transcripts; read `reports` and `reportSnapshots`.
- AC2 → `convex/reports.test.ts` (new, convex-test): `createProvenance` through `t.run` with a frozen source row and one citation, then `reviewClaimCitation`, asserting `sourceTranscriptIds` on both rows. `tests/chatProposals.test.ts` fixture rows are not touched: the new field is optional, the file is `bun:test` and not a gate step.
- AC3 → `convex/lib/snapshots.test.ts` (new, vitest, picked up by the `convex` project): port the Map-backed fake db from `tests/snapshots.test.ts:116-120` and write list expectations for each existing scenario (matching, legacy generation only, stale). `tests/snapshots.test.ts` stays as is (bun, not a gate step); do not extend it.
- AC4 → `convex/projects.test.ts:292-354`.
- AC5 → `convex/lib/snapshots.test.ts` or a `convex/snapshots.test.ts` case.

## Implementation notes
- `SnapshotAuditSource` / `SnapshotAuditFields` (`lib/snapshots.ts:11-24`) gain `sourceTranscriptIds?`. Derive from the winning generation: `generation.transcriptIds ?? (generation.transcriptId ? [generation.transcriptId] : undefined)`, validated per id with `validTranscriptId`. Do not add list-based conflict rules.
- `createProvenance` args (`reports.ts:74-132`): `sourceTranscriptIds: v.optional(v.array(v.id("transcripts")))`, `digestIds: v.optional(v.array(v.id("transcriptDigests")))` (stored now, written by `transcripts-7`).
- `pipeline.ts:680-689`: pass `sourceTranscriptIds: input.transcriptIds` (add `transcriptIds` to `getGenerationInput`).
- Every write keeps the single id first in source order.
- Do not touch UI or export code. Do not add vitest projects or move bun files.

## Edge cases
- Generation with `transcriptIds: []` (docs-only): report gets no `sourceTranscriptId` and `sourceTranscriptIds: []`.
- Legacy report with `sourceTranscriptId` only, restored from a legacy snapshot: the rule is one-directional and generation-driven. If the snapshot carries a `generationId` and that generation resolves, `snapshotAuditFields` derives `sourceTranscriptIds` from it (legacy generation → `[transcriptId]`, per AC3) and the restored report gets that list. Only when there is no resolvable generation AND no explicit list passed in are the lists absent on both; nothing is invented from the single `sourceTranscriptId` alone. (Resolves the AC3 / edge-case ambiguity raised in validation-2.)
- Provenance row whose `sourceTranscriptId` conflicts with the generation's: existing rule drops the provenance link; the list follows the generation.
