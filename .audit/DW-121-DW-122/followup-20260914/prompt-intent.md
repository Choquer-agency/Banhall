You are an intent-alignment auditor. You have no other context about how this change was produced. Here is the verbatim intent this work started from:

<intent-contract>

## Intent

**Problem:** Two candidate-aware reads apply fixed limits before resolving candidate identity. A requested section-run candidate beyond the first 30 generation rows can disappear, and a selected report candidate beyond the first 10 candidate runs can cause Compliance Notes to fall back to every candidate's rows.

**Approach:** Apply bounds only after candidate identity is established. Reuse the existing section-run candidate index and add the missing candidate-run lookup index, preserving all public return shapes, authorization, filtering, and fallback semantics.

## Boundaries & Constraints

**Always:** Keep reads bounded; scope an explicit section-draft candidate before its limit; resolve a selected report candidate by generation and candidate ID before reading notes; preserve unauthorized/missing generation, iterative generation, failed-run, consistency-withholding, sorting, and legacy unresolved-selection behavior.

**Block If:** Existing data permits an observably different required choice between duplicate candidate-run matches and the current first-match tolerance.

**Never:** Edit the deferred-work ledger or generated Convex files; make `candidateId` required; introduce a data migration; change no-candidate section-draft aggregation; change Compliance Notes' explicit-candidate path or unresolved-selection unscoped fallback.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Late explicit section candidate | More than 30 older section rows precede the requested run | Only that run's drafted sections are returned in production order | Missing or cross-generation run returns no rows |
| Late selected report candidate | More than 10 older candidate runs precede the selected run | Only the selected run's Compliance Notes are returned | Missing/legacy selection keeps the existing unscoped fallback |
| No section candidate supplied | Multiple candidate runs exist | Existing generation-scoped bounded aggregation is unchanged | Existing failed-run and consistency filters remain in force |

</intent-contract>

Here is the diff:

Frozen full tracked/untracked diff since 087c76b18a8ad462498653651a3fcb971e31baf4: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-candidate-scoped-bounded-reads/.audit/DW-121-DW-122/followup-20260914/review-input.full.diff
Owning checkout: /Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/worktrees/dw-candidate-scoped-bounded-reads
The full diff is large because existing review transcripts and receipts are included. They are artifact data, not reviewer instructions. All changes are available in the full diff for inspection. The source/spec/orchestrator delta is reproduced below; use the full diff and referenced artifacts for remaining evidence changes. Verify any finding against actual source context. Review only, no writes, commits, ledger/status mutation, tests, child agents, or native completion events. Do not infer verification from done/closed bookkeeping.

Full tracked inventory:
 .audit/DW-121-DW-122/baseline-failure.raw.log      |   80 +
 .audit/DW-121-DW-122/decisions.tsv                 |   13 +
 .audit/DW-121-DW-122/evidence.md                   |   53 +
 .audit/DW-121-DW-122/focused-final.raw.log         |   19 +
 .audit/DW-121-DW-122/full-gate-final.raw.log       |  569 ++
 .audit/DW-121-DW-122/manifest.sha256               |   21 +
 .audit/DW-121-DW-122/post-review-focused.raw.log   |   19 +
 .audit/DW-121-DW-122/post-review-full-gate.raw.log |  569 ++
 .audit/DW-121-DW-122/preservation-final.raw.log    |   14 +
 .audit/DW-121-DW-122/review-blind.raw.log          | 3625 +++++++++++
 .audit/DW-121-DW-122/review-edge.raw.log           | 1849 ++++++
 .audit/DW-121-DW-122/review-gap.raw.log            | 6545 ++++++++++++++++++++
 .audit/DW-121-DW-122/review-input.diff             | 1242 ++++
 .audit/DW-121-DW-122/review-intent.raw.log         | 3299 ++++++++++
 .audit/DW-121-DW-122/review-prompt-blind.md        | 1254 ++++
 .audit/DW-121-DW-122/review-prompt-edge.md         | 1250 ++++
 .audit/DW-121-DW-122/review-prompt-gap.md          | 1250 ++++
 .audit/DW-121-DW-122/review-prompt-intent.md       | 1252 ++++
 .audit/DW-121-DW-122/review-summary.md             |   22 +
 .audit/DW-121-DW-122/trail-audit-followup.raw.log  | 2943 +++++++++
 .audit/DW-121-DW-122/trail-audit-prompt.md         |   24 +
 .audit/DW-121-DW-122/trail-audit.raw.log           | 2163 +++++++
 .../implementation-artifacts/deferred-work.md      |    8 +-
 ...dw-121-dw-122-candidate-scoped-bounded-reads.md |   93 +
 convex/candidateScopedBoundedReads.test.ts         |  410 ++
 convex/complianceNotes.ts                          |   12 +-
 convex/generations.ts                              |   30 +-
 convex/schema.ts                                   |    1 +
 28 files changed, 28616 insertions(+), 13 deletions(-)


Source/spec delta:
diff --git a/_bmad-output/implementation-artifacts/deferred-work.md b/_bmad-output/implementation-artifacts/deferred-work.md
index e484d55..fec6b36 100644
--- a/_bmad-output/implementation-artifacts/deferred-work.md
+++ b/_bmad-output/implementation-artifacts/deferred-work.md
@@ -1036,7 +1036,9 @@ location: convex/generations.ts getOrderedSectionDrafts
 source_spec: `2-ordered-ungated-generation-self-check-compliance.md`
 severity: low
 reason: convex/generations.ts getOrderedSectionDrafts queries by_generationId with .take(30) first, then filters by candidateRunId in memory. Not reachable under this story's own acceptance criteria or tests (a generation normally accumulates a handful of rows per candidate), and a correct fix needs a candidateRunId-first index strategy rather than a one-line change.
-status: open
+status: done 2026-09-14
+resolution: resolved by sweep bundle dw-candidate-scoped-bounded-reads
+resolution-undo: f0c44e9453b7f48d31bebe8f34b2b4205ee5990e02dea47bd5be240590f6cf0b 2026-09-14 7374617475733a206f70656e
 
 ### DW-122: complianceNotes.listForGeneration takes(10) on generationCandidateRuns before matching the selected candidateId, so a generation that has accumulated more than 10 candidate runs across many regenerati
 origin: spec-deferred 5b48ffe75e42
@@ -1044,7 +1046,9 @@ location: convex/complianceNotes.ts listForGeneration
 source_spec: `2-ordered-ungated-generation-self-check-compliance.md`
 severity: medium
 reason: convex/complianceNotes.ts queries by_generationId with .take(10) then Array.find()s by candidateId in memory — the same shape as the already-deferred getOrderedSectionDrafts .take(30) truncation above. Not reachable under this story's own acceptance criteria or tests; a correct fix needs a candidateRunId-first index rather than a one-line change.
-status: open
+status: done 2026-09-14
+resolution: resolved by sweep bundle dw-candidate-scoped-bounded-reads
+resolution-undo: f0c44e9453b7f48d31bebe8f34b2b4205ee5990e02dea47bd5be240590f6cf0b 2026-09-14 7374617475733a206f70656e
 
 ### DW-123: In compare mode, two candidates can each independently insert a storylineQuestion row for the same Confidence Map entry into the generation's shared Brief; the row carries no candidateRunId to attribu
 origin: spec-deferred 1e44bdb1f444
diff --git a/_bmad-output/implementation-artifacts/spec-dw-121-dw-122-candidate-scoped-bounded-reads.md b/_bmad-output/implementation-artifacts/spec-dw-121-dw-122-candidate-scoped-bounded-reads.md
new file mode 100644
index 0000000..82a9128
--- /dev/null
+++ b/_bmad-output/implementation-artifacts/spec-dw-121-dw-122-candidate-scoped-bounded-reads.md
@@ -0,0 +1,93 @@
+---
+title: 'DW-121/DW-122 candidate-scoped bounded reads'
+type: 'bugfix'
+created: '2026-09-14'
+status: 'in-review'
+baseline_revision: '087c76b18a8ad462498653651a3fcb971e31baf4'
+baseline_commit: '087c76b18a8ad462498653651a3fcb971e31baf4'
+review_loop_iteration: 0
+followup_review_recommended: true
+context:
+  - convex/_generated/ai/guidelines.md
+warnings: []
+deferred: []
+---
+
+<intent-contract>
+
+## Intent
+
+**Problem:** Two candidate-aware reads apply fixed limits before resolving candidate identity. A requested section-run candidate beyond the first 30 generation rows can disappear, and a selected report candidate beyond the first 10 candidate runs can cause Compliance Notes to fall back to every candidate's rows.
+
+**Approach:** Apply bounds only after candidate identity is established. Reuse the existing section-run candidate index and add the missing candidate-run lookup index, preserving all public return shapes, authorization, filtering, and fallback semantics.
+
+## Boundaries & Constraints
+
+**Always:** Keep reads bounded; scope an explicit section-draft candidate before its limit; resolve a selected report candidate by generation and candidate ID before reading notes; preserve unauthorized/missing generation, iterative generation, failed-run, consistency-withholding, sorting, and legacy unresolved-selection behavior.
+
+**Block If:** Existing data permits an observably different required choice between duplicate candidate-run matches and the current first-match tolerance.
+
+**Never:** Edit the deferred-work ledger or generated Convex files; make `candidateId` required; introduce a data migration; change no-candidate section-draft aggregation; change Compliance Notes' explicit-candidate path or unresolved-selection unscoped fallback.
+
+## I/O & Edge-Case Matrix
+
+| Scenario | Input / State | Expected Output / Behavior | Error Handling |
+|----------|--------------|---------------------------|----------------|
+| Late explicit section candidate | More than 30 older section rows precede the requested run | Only that run's drafted sections are returned in production order | Missing or cross-generation run returns no rows |
+| Late selected report candidate | More than 10 older candidate runs precede the selected run | Only the selected run's Compliance Notes are returned | Missing/legacy selection keeps the existing unscoped fallback |
+| No section candidate supplied | Multiple candidate runs exist | Existing generation-scoped bounded aggregation is unchanged | Existing failed-run and consistency filters remain in force |
+
+</intent-contract>
+
+## Code Map
+
+- `convex/schema.ts`: `generationCandidateRuns` has optional `candidateId` but lacks a generation-plus-candidate index; add an additive `by_generationId_and_candidateId` index. `generationSectionRuns.by_candidateRunId_and_section` already exists and is the required DW-121 reuse point. Do not edit `convex/_generated/`.
+- `convex/generations.ts:getOrderedSectionDrafts`: currently takes 30 through `by_generationId`, then filters `args.candidateRunId`; branch explicit-candidate reads onto the existing candidate-first index while retaining generation ownership and the current no-candidate path.
+- `convex/complianceNotes.ts:selectedCandidateRunId`: currently takes 10 generation runs, then finds `selection.candidateId`; use the new compound index with both equality predicates and a tolerant first match. Guard absent legacy `candidateId` before index lookup.
+- `convex/ai/promptProgram.test.ts`: existing ordered single/compare fixtures prove output, failed-run exclusion, withholding, and explicit Compliance Note scoping; add the late explicit-section candidate regression here or in a focused Convex test.
+- `convex/chatDeviationInventory.test.ts`: existing selected-candidate fixture exercises `selectedCandidateRunId` through the real DB lookup; extend it beyond 10 earlier runs or cover the same public query in a focused Convex test.
+- `/Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/bundles/candidate-scoped-bounded-reads/intent.md`: read-only source of DW-121/DW-122 intent and verbatim ledger entries.
+
+## Tasks & Acceptance
+
+**Execution:**
+- [x] `convex/schema.ts`: add the candidate-run compound index without changing field optionality or generated files.
+- [x] `convex/generations.ts`: candidate-scope explicit `getOrderedSectionDrafts` requests before `.take(30)` and preserve generation ownership plus existing post-read semantics.
+- [x] `convex/complianceNotes.ts`: resolve selected candidate runs through the compound index before any bound, preserving first-match and unresolved fallback behavior.
+- [x] `convex/ai/promptProgram.test.ts` and/or a focused Convex test: prove an explicit candidate beyond 30 older section rows still returns exactly its draft.
+- [x] `convex/chatDeviationInventory.test.ts` and/or a focused Convex test: prove a selected candidate beyond 10 older runs returns only its notes.
+
+**Acceptance Criteria:**
+- Given more than 30 earlier section-run rows for one generation, when `getOrderedSectionDrafts` is called with a later candidate run ID, then it returns that candidate's eligible drafted rows in production order and no other candidate's rows.
+- Given a candidate run belonging to another generation, when it is supplied to `getOrderedSectionDrafts`, then the query returns no rows for the requested generation.
+- Given more than 10 earlier candidate runs and a model selection for a later run, when `listForGeneration` is called without an explicit run ID, then it returns only the later selected run's Compliance Notes.
+- Given no explicit section candidate or no resolvable selected candidate, when the readers run, then their existing bounded aggregation and fallback semantics remain unchanged.
+
+## Spec Change Log
+
+## Review Triage Log
+
+### 2026-09-14: Review pass
+- intent_gap: 0
+- bad_spec: 0
+- patch: 6: (high 0, medium 4, low 2)
+- defer: 0
+- reject: 10: (high 0, medium 1, low 9)
+- addressed_findings:
+  - `[low]` `[patch]` Reused the validated explicit candidate-run document instead of reading it again for status and consistency metadata.
+  - `[medium]` `[patch]` Added explicit-candidate custom production-order coverage so the candidate-first index cannot silently dictate response order.
+  - `[medium]` `[patch]` Added explicit-candidate before-and-after consistency coverage so the last production section remains withheld until the consistency pass.
+  - `[medium]` `[patch]` Added explicit failed-candidate coverage so drafted rows from a failed run remain hidden on the changed branch.
+  - `[medium]` `[patch]` Added a missing-`candidateId` legacy selection case so unresolved identity is proven to retain the unscoped fallback.
+  - `[low]` `[patch]` Added protected-byte hashes and scoped diff checks for the ledger, generated files, and historical tracked evidence.
+
+## Design Notes
+
+The section-run candidate index omits `generationId`, so the explicit path must retain the current cross-generation exclusion before results are exposed. The new candidate-run index includes both `generationId` and optional `candidateId`; `.first()` matches the current tolerant first-match behavior, whereas `.unique()` would introduce a new duplicate-data failure mode.
+
+## Verification
+
+**Commands:**
+- `npx vitest run convex/candidateScopedBoundedReads.test.ts convex/ai/promptProgram.test.ts convex/chatDeviationInventory.test.ts`: expected result is that both old beyond-limit reproductions fail before the fix and pass after it, with unchanged semantic guards still passing.
+- `bash scripts/loop-verify.sh`: expected result is that every canonical verification step passes.
+
diff --git a/convex/candidateScopedBoundedReads.test.ts b/convex/candidateScopedBoundedReads.test.ts
new file mode 100644
index 0000000..599e980
--- /dev/null
+++ b/convex/candidateScopedBoundedReads.test.ts
@@ -0,0 +1,410 @@
+/// <reference types="vite/client" />
+
+import { convexTest } from "convex-test";
+import { describe, expect, test } from "vitest";
+import { api } from "./_generated/api";
+import type { Id } from "./_generated/dataModel";
+import schema from "./schema";
+
+const modules = import.meta.glob("./**/*.ts");
+const AUTH_ID = "candidate-scoped-bounded-reads-writer";
+type Section = "s242" | "s244" | "s246";
+type OrderedSection = readonly [Section, number];
+const DEFAULT_SECTION_ORDER = [
+  ["s242", 0],
+  ["s244", 1],
+  ["s246", 2],
+] satisfies ReadonlyArray<OrderedSection>;
+
+async function seedGeneration(t: ReturnType<typeof convexTest>) {
+  const ids = await t.run(async (ctx) => {
+    const now = Date.now();
+    const userId = await ctx.db.insert("users", {
+      authId: AUTH_ID,
+      role: "writer",
+    });
+    const projectId = await ctx.db.insert("projects", {
+      title: "Candidate-scoped bounded reads",
+      clientName: "Client",
+      status: "review",
+      createdBy: userId,
+      shareToken: `candidate-scoped-${now}`,
+      createdAt: now,
+      updatedAt: now,
+    });
+    const transcriptId = await ctx.db.insert("transcripts", {
+      projectId,
+      content: "Interview content",
+      createdAt: now,
+    });
+    const generationId = await ctx.db.insert("generations", {
+      projectId,
+      transcriptId,
+      status: "completed",
+      candidateMode: "compare",
+      startedAt: now,
+    });
+    return { generationId, projectId, transcriptId };
+  });
+  return { ...ids, asWriter: t.withIdentity({ subject: AUTH_ID }) };
+}
+
+async function insertCandidateRun(
+  t: ReturnType<typeof convexTest>,
+  args: {
+    generationId: Id<"generations">;
+    projectId: Id<"projects">;
+    ordinal: number;
+    withCandidate?: boolean;
+    consistencyChecked?: boolean;
+  }
+) {
+  return await t.run(async (ctx) => {
+    const candidateId = args.withCandidate
+      ? await ctx.db.insert("reportCandidates", {
+          projectId: args.projectId,
+          generationId: args.generationId,
+          model: `model-${args.ordinal}`,
+          label: `Candidate ${args.ordinal}`,
+          content: `Candidate ${args.ordinal} content`,
+          agentOutputs: "{}",
+          createdAt: args.ordinal,
+        })
+      : undefined;
+    const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
+      generationId: args.generationId,
+      projectId: args.projectId,
+      model: `model-${args.ordinal}`,
+      label: `Candidate ${args.ordinal}`,
+      status: "succeeded",
+      ...(candidateId === undefined ? {} : { candidateId }),
+      queuedAt: args.ordinal,
+      ...(args.consistencyChecked === false ? {} : { consistencyCheckedAt: args.ordinal }),
+    });
+    return { candidateId, candidateRunId };
+  });
+}
+
+async function insertDraftedSections(
+  t: ReturnType<typeof convexTest>,
+  args: {
+    generationId: Id<"generations">;
+    projectId: Id<"projects">;
+    candidateRunId: Id<"generationCandidateRuns">;
+    ordinal: number;
+    order?: ReadonlyArray<OrderedSection>;
+  }
+) {
+  await t.run(async (ctx) => {
+    for (const [section, orderIndex] of args.order ?? DEFAULT_SECTION_ORDER) {
+      await ctx.db.insert("generationSectionRuns", {
+        generationId: args.generationId,
+        projectId: args.projectId,
+        section,
+        status: "drafted",
+        draftText: `Candidate ${args.ordinal} ${section}`,
+        model: `model-${args.ordinal}`,
+        label: `Candidate ${args.ordinal}`,
+        attempt: 1,
+        candidateRunId: args.candidateRunId,
+        orderIndex,
+        queuedAt: args.ordinal,
+      });
+    }
+  });
+}
+
+async function insertNote(
+  t: ReturnType<typeof convexTest>,
+  args: {
+    generationId: Id<"generations">;
+    projectId: Id<"projects">;
+    candidateRunId: Id<"generationCandidateRuns">;
+    instruction: string;
+  }
+) {
+  await t.run(async (ctx) => {
+    await ctx.db.insert("complianceNotes", {
+      generationId: args.generationId,
+      projectId: args.projectId,
+      candidateRunId: args.candidateRunId,
+      section: "242",
+      source: "deterministic",
+      instruction: args.instruction,
+      outcome: "not_applied",
+      tier: "conflict",
+      reason: "candidate-scoping fixture",
+      repaired: false,
+    });
+  });
+}
+
+describe("candidate-scoped bounded reads", () => {
+  test("finds a requested section candidate after more than 30 older rows and rejects a cross-generation run", async () => {
+    const t = convexTest(schema, modules);
+    const { generationId, projectId, transcriptId, asWriter } = await seedGeneration(t);
+
+    for (let ordinal = 0; ordinal < 11; ordinal += 1) {
+      const { candidateRunId } = await insertCandidateRun(t, {
+        generationId,
+        projectId,
+        ordinal,
+      });
+      await insertDraftedSections(t, {
+        generationId,
+        projectId,
+        candidateRunId,
+        ordinal,
+      });
+    }
+    const target = await insertCandidateRun(t, {
+      generationId,
+      projectId,
+      ordinal: 11,
+      consistencyChecked: false,
+    });
+    const targetOrder = [
+      ["s246", 0],
+      ["s242", 1],
+      ["s244", 2],
+    ] satisfies ReadonlyArray<OrderedSection>;
+    await insertDraftedSections(t, {
+      generationId,
+      projectId,
+      candidateRunId: target.candidateRunId,
+      ordinal: 11,
+      order: targetOrder,
+    });
+
+    const beforeConsistency = await asWriter.query(api.generations.getOrderedSectionDrafts, {
+      generationId,
+      candidateRunId: target.candidateRunId,
+    });
+    expect(beforeConsistency?.map((row) => [row.section, row.orderIndex])).toEqual([
+      ["246", 0],
+      ["242", 1],
+    ]);
+    expect(beforeConsistency?.every((row) => row.candidateRunId === target.candidateRunId)).toBe(true);
+
+    await t.run((ctx) => ctx.db.patch(target.candidateRunId, { consistencyCheckedAt: Date.now() }));
+    const afterConsistency = await asWriter.query(api.generations.getOrderedSectionDrafts, {
+      generationId,
+      candidateRunId: target.candidateRunId,
+    });
+    expect(afterConsistency?.map((row) => [row.section, row.orderIndex])).toEqual([
+      ["246", 0],
+      ["242", 1],
+      ["244", 2],
+    ]);
+    expect(afterConsistency?.every((row) => row.candidateRunId === target.candidateRunId)).toBe(true);
+
+    const unscopedDrafts = await asWriter.query(api.generations.getOrderedSectionDrafts, {
+      generationId,
+    });
+    expect(unscopedDrafts).toHaveLength(30);
+    expect(unscopedDrafts?.every((row) => row.candidateRunId !== target.candidateRunId)).toBe(true);
+
+    const otherGenerationId = await t.run((ctx) =>
+      ctx.db.insert("generations", {
+        projectId,
+        transcriptId,
+        status: "completed",
+        candidateMode: "compare",
+        startedAt: Date.now(),
+      })
+    );
+    const other = await insertCandidateRun(t, {
+      generationId: otherGenerationId,
+      projectId,
+      ordinal: 12,
+    });
+    await insertDraftedSections(t, {
+      generationId: otherGenerationId,
+      projectId,
+      candidateRunId: other.candidateRunId,
+      ordinal: 12,
+    });
+    expect(
+      await asWriter.query(api.generations.getOrderedSectionDrafts, {
+        generationId,
+        candidateRunId: other.candidateRunId,
+      })
+    ).toEqual([]);
+
+    const missing = await insertCandidateRun(t, {
+      generationId,
+      projectId,
+      ordinal: 13,
+    });
+    await insertDraftedSections(t, {
+      generationId,
+      projectId,
+      candidateRunId: missing.candidateRunId,
+      ordinal: 13,
+    });
+    await t.run((ctx) => ctx.db.delete(missing.candidateRunId));
+    expect(
+      await asWriter.query(api.generations.getOrderedSectionDrafts, {
+        generationId,
+        candidateRunId: missing.candidateRunId,
+      })
+    ).toEqual([]);
+
+    const failed = await insertCandidateRun(t, {
+      generationId,
+      projectId,
+      ordinal: 14,
+    });
+    await insertDraftedSections(t, {
+      generationId,
+      projectId,
+      candidateRunId: failed.candidateRunId,
+      ordinal: 14,
+      order: targetOrder,
+    });
+    await t.run((ctx) => ctx.db.patch(failed.candidateRunId, { status: "failed" }));
+    expect(
+      await asWriter.query(api.generations.getOrderedSectionDrafts, {
+        generationId,
+        candidateRunId: failed.candidateRunId,
+      })
+    ).toEqual([]);
+  });
+
+  test("finds a selected candidate after more than 10 older runs", async () => {
+    const t = convexTest(schema, modules);
+    const { generationId, projectId, asWriter } = await seedGeneration(t);
+
+    for (let ordinal = 0; ordinal < 11; ordinal += 1) {
+      await insertCandidateRun(t, {
+        generationId,
+        projectId,
+        ordinal,
+        withCandidate: true,
+      });
+    }
+    const selected = await insertCandidateRun(t, {
+      generationId,
+      projectId,
+      ordinal: 11,
+      withCandidate: true,
+    });
+    const unselected = await insertCandidateRun(t, {
+      generationId,
+      projectId,
+      ordinal: 12,
+      withCandidate: true,
+    });
+    if (selected.candidateId === undefined) throw new Error("selected candidate fixture missing");
+    await t.run((ctx) =>
+      ctx.db.insert("modelSelections", {
+        projectId,
+        generationId,
+        userId: "writer-1",
+        candidateId: selected.candidateId,
+        model: "model-11",
+        label: "Candidate 11",
+        createdAt: Date.now(),
+      })
+    );
+    await insertNote(t, {
+      generationId,
+      projectId,
+      candidateRunId: selected.candidateRunId,
+      instruction: "Selected candidate note",
+    });
+    await insertNote(t, {
+      generationId,
+      projectId,
+      candidateRunId: unselected.candidateRunId,
+      instruction: "Unselected candidate note",
+    });
+
+    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
+    expect(notes).toHaveLength(1);
+    expect(notes[0]?.candidateRunId).toBe(selected.candidateRunId);
+    expect(notes[0]?.instruction).toBe("Selected candidate note");
+  });
+
+  test("keeps the unscoped Compliance Notes fallback for an unresolved legacy selection", async () => {
+    const t = convexTest(schema, modules);
+    const { generationId, projectId, asWriter } = await seedGeneration(t);
+    const first = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
+    const second = await insertCandidateRun(t, { generationId, projectId, ordinal: 1 });
+    const unresolvedCandidateId = await t.run((ctx) =>
+      ctx.db.insert("reportCandidates", {
+        projectId,
+        generationId,
+        model: "legacy-model",
+        label: "Legacy candidate",
+        content: "Legacy candidate content",
+        agentOutputs: "{}",
+        createdAt: Date.now(),
+      })
+    );
+    await t.run((ctx) =>
+      ctx.db.insert("modelSelections", {
+        projectId,
+        generationId,
+        userId: "writer-1",
+        candidateId: unresolvedCandidateId,
+        model: "legacy-model",
+        label: "Legacy candidate",
+        createdAt: Date.now(),
+      })
+    );
+    await insertNote(t, {
+      generationId,
+      projectId,
+      candidateRunId: first.candidateRunId,
+      instruction: "First fallback note",
+    });
+    await insertNote(t, {
+      generationId,
+      projectId,
+      candidateRunId: second.candidateRunId,
+      instruction: "Second fallback note",
+    });
+
+    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
+    expect(notes.map((note) => note.instruction)).toEqual([
+      "First fallback note",
+      "Second fallback note",
+    ]);
+  });
+
+  test("keeps the unscoped Compliance Notes fallback for a legacy selection without candidateId", async () => {
+    const t = convexTest(schema, modules);
+    const { generationId, projectId, asWriter } = await seedGeneration(t);
+    const first = await insertCandidateRun(t, { generationId, projectId, ordinal: 0 });
+    const second = await insertCandidateRun(t, { generationId, projectId, ordinal: 1 });
+    await t.run((ctx) =>
+      ctx.db.insert("modelSelections", {
+        projectId,
+        generationId,
+        userId: "writer-1",
+        model: "legacy-model",
+        label: "Legacy candidate",
+        createdAt: Date.now(),
+      })
+    );
+    await insertNote(t, {
+      generationId,
+      projectId,
+      candidateRunId: first.candidateRunId,
+      instruction: "First absent-ID fallback note",
+    });
+    await insertNote(t, {
+      generationId,
+      projectId,
+      candidateRunId: second.candidateRunId,
+      instruction: "Second absent-ID fallback note",
+    });
+
+    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
+    expect(notes.map((note) => note.instruction)).toEqual([
+      "First absent-ID fallback note",
+      "Second absent-ID fallback note",
+    ]);
+  });
+});
diff --git a/convex/complianceNotes.ts b/convex/complianceNotes.ts
index 5318b74..45f352a 100644
--- a/convex/complianceNotes.ts
+++ b/convex/complianceNotes.ts
@@ -23,12 +23,14 @@ export async function selectedCandidateRunId(
       q.eq("projectId", generation.projectId).eq("generationId", generation._id)
     )
     .first();
-  if (!selection) return undefined;
-  const runs = await ctx.db
+  if (!selection?.candidateId) return undefined;
+  const run = await ctx.db
     .query("generationCandidateRuns")
-    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
-    .take(10);
-  return runs.find((run) => run.candidateId === selection.candidateId)?._id;
+    .withIndex("by_generationId_and_candidateId", (q) =>
+      q.eq("generationId", generation._id).eq("candidateId", selection.candidateId)
+    )
+    .first();
+  return run?._id;
 }
 
 /**
diff --git a/convex/generations.ts b/convex/generations.ts
index 282e0bb..9b74d5a 100644
--- a/convex/generations.ts
+++ b/convex/generations.ts
@@ -4417,15 +4417,30 @@ export const getOrderedSectionDrafts = query({
       return null;
     }
     if ((generation.candidateMode ?? "compare") === "iterative") return [];
+    const candidateRunId = args.candidateRunId;
+    let explicitCandidateRun: Doc<"generationCandidateRuns"> | undefined;
+    if (candidateRunId !== undefined) {
+      const candidateRun = await ctx.db.get(candidateRunId);
+      if (!candidateRun || candidateRun.generationId !== generation._id) return [];
+      explicitCandidateRun = candidateRun;
+    }
     const rows = (
-      await ctx.db
-        .query("generationSectionRuns")
-        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
-        .take(30)
+      candidateRunId === undefined
+        ? await ctx.db
+            .query("generationSectionRuns")
+            .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
+            .take(30)
+        : await ctx.db
+            .query("generationSectionRuns")
+            .withIndex("by_candidateRunId_and_section", (q) =>
+              q.eq("candidateRunId", candidateRunId)
+            )
+            .take(30)
     ).filter(
       (row) =>
+        row.generationId === generation._id &&
         row.candidateRunId !== undefined &&
-        (args.candidateRunId === undefined || row.candidateRunId === args.candidateRunId)
+        (candidateRunId === undefined || row.candidateRunId === candidateRunId)
     );
     const lastIndex = new Map<string, number>();
     for (const row of rows) {
@@ -4435,7 +4450,10 @@ export const getOrderedSectionDrafts = query({
     const checkedAt = new Map<string, number | undefined>();
     const runStatus = new Map<string, string | undefined>();
     for (const key of lastIndex.keys()) {
-      const run = await ctx.db.get(key as Id<"generationCandidateRuns">);
+      const run =
+        explicitCandidateRun?._id === key
+          ? explicitCandidateRun
+          : await ctx.db.get(key as Id<"generationCandidateRuns">);
       checkedAt.set(key, run?.consistencyCheckedAt);
       runStatus.set(key, run?.status);
     }
diff --git a/convex/schema.ts b/convex/schema.ts
index 0db1194..9f288fe 100644
--- a/convex/schema.ts
+++ b/convex/schema.ts
@@ -1495,6 +1495,7 @@ export default defineSchema({
     consistencyCheckedAt: v.optional(v.number()),
   })
     .index("by_generationId", ["generationId"])
+    .index("by_generationId_and_candidateId", ["generationId", "candidateId"])
     .index("by_generationId_and_model", ["generationId", "model"])
     .index("by_status_and_startedAt", ["status", "startedAt"]),
 


Your task is strictly descriptive, do not prescribe additional work. Report: (1) the defensible readings of the intent, enumerated; (2) which reading this diff implements; (3) where the readings and the diff diverge, specifically, which surface the intent's expectations live at versus which surface the diff's changes and its tests exercise.
