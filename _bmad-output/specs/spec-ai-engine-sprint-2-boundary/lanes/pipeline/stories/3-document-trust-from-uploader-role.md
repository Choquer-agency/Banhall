---
title: 'Document trust from uploader role'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: '23317ce915c482cd6b8e23853a3dd810cb899c62'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The PD-review path still interpolates a document's raw category into the
      model prompt without passing through the trust seam.
    evidence: |-
      convex/documents.ts getContextDocsForGeneration selects only
      category/fileName/content, and convex/ai/reviewAgent.ts annotates that
      result as ContextDoc[] before writing "## Supporting document - <file>
      (<category>)" straight into the user message. So reviewAgent can label a
      document writer_notes with no uploader-role check and no BEGIN/END
      markers, and the ContextDoc[] annotation now falsely implies the row went
      through documentTrust. Pre-existing (reviewAgent never used
      trustedContext) and explicitly out of scope for this story, but the
      misleading type is new as of CAP-3.
    location: >-
      convex/ai/reviewAgent.ts:81 / convex/documents.ts getContextDocsForGeneration
    severity: medium
  - summary: >-
      A demotion is invisible to the writer who tagged the document: no query,
      no UI, and no progress-log line reports that a writer_notes document was
      treated as client evidence.
    evidence: |-
      report.sources[].trust is telemetry the model never sees and nothing reads
      it back. describeContextCuts names truncation and omission but not
      demotion. A writer picks "Writer's notes" in src/lib/contextCategories.ts
      and, for any row predating CAP-3, silently gets ordinary client evidence
      plus a lower budget priority. This story bars UI edits, so it needs its
      own work item. Same shape as story 2's deferred "nothing surfaces
      context-budget truncation to a human".
    location: >-
      convex/ai/trustedContext.ts (report.sources[].trust) / no consumer
    severity: medium
  - summary: >-
      CAP-3 as specified cannot reach the threat its own success criterion
      names, because no client-facing upload path exists.
    evidence: |-
      Every projectDocuments writer (documents.ts, ingestionPort.ts,
      projects.ts, reviewFromProject.ts) is behind requireInternalProjectAccess
      or an admin check, and users.role has no client member. So a
      "client-uploaded file tagged writer_notes" is not a producible runtime
      state; the demotion only ever fires on rows predating the field. The open
      case is an internal writer uploading a client-supplied file and tagging it
      writer_notes, which uploader role cannot distinguish. Closing it needs a
      different signal (document origin or intake channel), which is an epic-level
      decision.
    location: >-
      convex/lib/auth.ts:44-60 (every upload path is internal)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `documentTrust` in `convex/ai/trustedContext.ts` grants a document HIGHEST TRUST purely because its `category` field says `writer_notes` — a field any uploader can pick from a dropdown. `CONTEXT_INPUTS_GUIDANCE` then tells the analyzer that writer's notes are authoritative direction that "win" over the transcript and "tell you what to ignore", so a mislabelled or client-supplied file becomes a channel for instructions the injection containment is specifically designed to block.

**Approach:** Record the uploader's internal role on `projectDocuments` at upload (CAP-3), freeze it onto the `generationSources` row at reservation, and re-derive `documentTrust` from that role instead of from the category. A `writer_notes` document whose row carries no internal uploader role is presented to the analyzer as ordinary client evidence — lowest trust label and ordering — so the guidance's "authoritative direction" clause can only ever attach to material an internal user actually uploaded.

## Boundaries & Constraints

**Always:**
- Fail closed. Absent `uploaderRole` (every row that predates this story, and any row whose writer is unknown) means client trust. No backfill job, no read-time join to `users` to guess a role.
- Trust is re-derived in `documentTrust` only. Every other consumer keeps reading `TrustLevel`, never the category, exactly as `trustedContext.ts` already documents.
- A demotion is total, not cosmetic: a `writer_notes` document that resolves to client trust must reach the model under the `OTHER SUPPORTING MATERIAL` label and in `other`'s position in the trust ordering. A block still labelled `WRITER'S NOTES (unreliable narrator)` is still authoritative direction to the model no matter what `report.sources[].trust` says.
- Schema changes are additive and optional on both `projectDocuments` and `generationSources`; existing rows stay valid.
- `CONTEXT_SCAFFOLDS`, `ANALYZER_CATEGORY_LABELS`, `ANALYZER_CATEGORY_ORDER` and `CONTEXT_INPUTS_GUIDANCE` keep their exact current bytes — this story changes which label a document gets, never the label text or the disclosed prompt contract.
- Copying a document (project duplicate) carries the source row's `uploaderRole` forward. Trust belongs to the content's origin, not to whoever pressed duplicate; re-deriving from the copier would launder a client file into internal direction.

**Block If:**
- The intent would require a public `api.*` argument shape change or a frontend edit to land.

**Never:**
- Do not add a client-facing upload path, a role-override argument, or any way for a caller to assert its own trust level.
- Do not touch `convex/ai/chatAgentV2.ts`, `convex/chatV2.ts` or `convex/ai/reviewAgent.ts` — chat evidence is CAP-4 (story 4) and `reviewAgent` assembles its own context outside this module.
- Do not backfill `uploaderRole` onto the deduped row in `uploadDocument`'s dedupe branch (the `processingStatus` backfill-on-touch precedent does not extend here: that derivation is a pure function of the dedupe key, this one is a fact about a different upload event).
- Do not edit any file named in the epic's parallel-epic exclusion list in `SPEC.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Internal writer's notes | `ContextDoc` `{category: "writer_notes", uploaderRole: "writer"}` | `documentTrust` → `internal`; block labelled `WRITER'S NOTES (unreliable narrator)`; sorted first | No error expected |
| Unattributed writer's notes | `{category: "writer_notes"}`, no `uploaderRole` | `documentTrust` → `client`; block labelled `OTHER SUPPORTING MATERIAL`; sorted in `other`'s position; `report.sources[].trust` is `client` | No error expected |
| Non-notes category | `{category: "previous_pd", uploaderRole: "admin"}` | `client` trust and `PREVIOUS-YEAR REPORT` label — an internal role never promotes a non-notes category | No error expected |
| Upload records the role | `uploadDocument` by a manager | New `projectDocuments` row carries `uploaderRole: "manager"` | `requireInternalProjectAccess` already guarantees a role; no new error path |
| Dedupe hit | Same (fileName, content) uploaded again | Existing row returned unchanged; its `uploaderRole` is not written | No error expected |
| Legacy frozen source | `generationSources` row with no `uploaderRole` | Analyzer receives the document as client evidence | No error expected |

</intent-contract>

## Code Map

- `convex/schema.ts:960-1026` -- `projectDocuments`; `category` at `:1009`, `uploadedBy: v.string()` at `:1019` (a free-form string — display label on some paths, `user._id` on others, so it is *not* a reliable join key to `users`; this is why the role is recorded at write time).
- `convex/schema.ts:1371-1407` -- `generationSources`; `label` is the `"category:fileName"` composite, `contextBudget` at `:1397` is the precedent for an optional, additive field on this table.
- `convex/schema.ts:14-40` -- `users.role` is `v.optional(v.union("writer","manager","admin"))`; there is no client role in this system.
- `convex/lib/auth.ts:44-60` -- `requireInternalProjectAccess` rejects anonymous records and any user without a role, so `user.role` is non-null at every insert site below.
- `convex/documents.ts:43-157` -- `uploadDocument`; auth at `:64`, dedupe branch at `:100-131` (returns early), the insert at `:134-148`.
- `convex/documents.ts:239-254` -- `getContextDocsForGeneration`, the live (unfrozen) query `reviewAgent` reads. Read-only for this story; its result is typed `ContextDoc[]` structurally, so adding an optional field does not break it.
- `convex/projects.ts:826-877` -- `copyProjectInputRows`; insert at `:856`, auth via `requireDuplicatePair`/`requireInternalProjectAccess` at `:821-822`. Carry `doc.uploaderRole` from the source row here.
- `convex/ingestionPort.ts:102-235` -- admin-only port; role checked at `:103-105`, insert at `:222`.
- `convex/reviewFromProject.ts:50,182-191` -- `requireInternalProjectAccess` at `:50`, insert at `:182`.
- `convex/generations.ts:484-503` -- `reserveGeneration` freezes each document into a `generationSources` row; `label` composed at `:496`.
- `convex/generations.ts:798-880` -- `getGenerationInput`; `contextDocs` mapped at `:864-875`, splitting `label` on the first `:` to recover the category.
- `convex/ai/pipeline.ts:185-208` -- `toContextDocs` narrows the frozen string category back to the `ContextDocCategory` union; the one place a frozen row becomes a `ContextDoc`.
- `convex/ai/trustedContext.ts:44-63` -- `ANALYZER_CATEGORY_LABELS`, `ANALYZER_CATEGORY_ORDER`, `documentTrust` (the seam story 2 left for this story, per its own comment at `:39-41`).
- `convex/ai/trustedContext.ts:233-238,325-360` -- `documentBlock` reads `ANALYZER_CATEGORY_LABELS[doc.category]`; the document loop sorts on `ANALYZER_CATEGORY_ORDER.indexOf(doc.category)` and sets `trust`/`category` on the report row. All three read the category directly and must move to the effective category.
- `convex/ai/prompts.ts:834-847` -- `CONTEXT_INPUTS_GUIDANCE`; line `:839` is the "HIGHEST TRUST … treat them as authoritative guidance" clause this story gates. Read-only.
- `convex/ai/trustedContext.test.ts:19-23,66-67,87-94,124,184,406,478` -- the `doc()` helper and every `writer_notes` fixture; `:87-94` asserts the old single-argument `documentTrust` and must be rewritten.
- `convex/ai/promptScaffolds.test.ts:100`, `convex/generationAttribution.test.ts:1203,2055` -- other `writer_notes` fixtures whose expected labels/ordering shift unless they supply an internal uploader role.
- `convex/documents.test.ts`, `convex/generationInput.test.ts` -- existing harnesses for the upload and freeze/read paths.
- `src/lib/contextCategories.ts` -- the category picker. Read-only: this story deliberately changes no UI.

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add optional `uploaderRole: v.union(v.literal("writer"), v.literal("manager"), v.literal("admin"))` to `projectDocuments` and to `generationSources`, each with a comment stating that absence means client trust -- the role must be a stored fact, because `uploadedBy` is not a usable join key.
- `convex/ai/trustedContext.ts` -- export the uploader-role type and an `isInternalUploaderRole` predicate; add optional `uploaderRole` to `ContextDoc`; change `documentTrust` to take the category and the uploader role; add an effective-category helper that maps a client-trust `writer_notes` document to `other`; use the effective category for the sort key, the block label, and the report row's `category` -- one function owns the demotion so no consumer can see a half-demoted document.
- `convex/documents.ts` -- record `uploaderRole: user.role` on the `uploadDocument` insert only (not in the dedupe branch) -- the role is a fact about this upload event.
- `convex/projects.ts` -- carry `doc.uploaderRole` from the source row in `copyProjectInputRows` -- a duplicate must report the same trust as its source.
- `convex/ingestionPort.ts` -- record the porting admin's role on the ported-PD insert.
- `convex/reviewFromProject.ts` -- record the acting user's role on the review-PD insert.
- `convex/generations.ts` -- freeze `document.uploaderRole` onto the `project_document` source row in `reserveGeneration`, and surface `uploaderRole` on each `contextDocs` entry in `getGenerationInput` -- trust must be pinned to the reservation, not re-read live.
- `convex/ai/pipeline.ts` -- pass `uploaderRole` through `toContextDocs`, narrowing the stored value to the role union the way `category` is already narrowed.
- `convex/ai/trustedContext.test.ts` -- update the `doc()` helper and the `writer_notes` fixtures to carry an internal role, rewrite the `documentTrust` case for the new signature, and add the demotion cases from the I/O matrix (label, ordering, and `report.sources[].trust`).
- `convex/documents.test.ts` -- assert `uploadDocument` stores `uploaderRole` and that the dedupe branch leaves the existing row's value alone.
- `convex/generationInput.test.ts` -- assert the frozen `generationSources` row carries `uploaderRole` and that `getGenerationInput` surfaces it on `contextDocs`.
- `convex/ai/promptScaffolds.test.ts`, `convex/generationAttribution.test.ts` -- update the `writer_notes` fixtures so their expected labels stay correct under the new derivation.

**Acceptance Criteria:**
- Given a project with a `writer_notes` document whose `generationSources` row has no `uploaderRole`, when the analyzer context is built, then the document's text appears inside `--- BEGIN [OTHER SUPPORTING MATERIAL] ... ---` markers and nowhere under the `WRITER'S NOTES` label.
- Given the same document with `uploaderRole: "writer"`, when the analyzer context is built, then it appears under `WRITER'S NOTES (unreliable narrator)` and ahead of every client-trust document.
- Given an internal user uploads a document, when `uploadDocument` returns, then the stored row carries that user's role, and when the same file is uploaded again, then the dedupe branch returns the original row with its `uploaderRole` unchanged.
- Given a document row created before this story, when a generation reserves and reads it, then no error occurs and the document is treated as client evidence.
- Given the whole change, when `npm test` and `npm run check` run, then both pass with no `api.*` argument shape change and no file under `src/` modified.

## Spec Change Log

## Review Triage Log

### 2026-09-04 - Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 3: (high 0, medium 3, low 0)
- reject: 8: (high 0, medium 2, low 6)
- addressed_findings:
  - `[medium]` `[patch]` `buildAnalyzerContext`'s declared `contextDocs` element type omitted `uploaderRole`, so the role survived only because callers spread the whole `getGenerationInput` result; added the field to the declared type.
  - `[medium]` `[patch]` The duplication carry-forward in `copyProjectInputRows` had no test - deleting the line broke nothing. Extended the duplication test with an attributed and a roleless `writer_notes` source row, and mutation-checked that the new assertion fails when the line is removed.
  - `[low]` `[patch]` `getGenerationInput` wrote `uploaderRole` unconditionally, emitting an explicit undefined-valued key; switched to the conditional spread used at every other optional site.
  - `[low]` `[patch]` The dedupe test only covered a roleless legacy row, so code patching an already-attributed row would have passed; added the stored-role-survives-a-different-uploader case.
  - `[low]` `[patch]` The `"uploaderRole" in row` justification cited a `t.run` serialization hazard that does not apply inside `t.run`; rewrote it to state the real reason.
  - `[low]` `[patch]` Two `generationAttribution.test.ts` comments described the opposite of the fixture line beneath them; corrected them, and recorded the budget consequence of demoted ordering on `effectiveCategory`.

### 2026-09-04 - Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 15: (high 0, medium 6, low 9)
- addressed_findings:
  - `[low]` `[patch]` No test ran a roleless frozen `writer_notes` row through the real entry action to the analyzer message; the legacy-source seam was covered in two disjoint halves. Added a roleless `generationSources` row to the `generateCandidate` fixture in `generationAttribution.test.ts` and asserted the `OTHER SUPPORTING MATERIAL` markers, no `WRITER'S NOTES` header for that file, and ordering after the attributed notes.
  - `[low]` `[patch]` The budget consequence of demotion (demoted document sorts last, so it is cut first) was narrated on `effectiveCategory` but pinned by no test. Added a total-budget test where a roleless `writer_notes` document loses to a `background` file.
  - `[low]` `[patch]` `finalizePort` and `createReviewProjectRecord` stamped `uploaderRole` with no assertion covering either insert. Added `uploaderRole: "admin"` to the ported-row `toMatchObject` and an `uploaderRole === "writer"` assertion on the review PD.
  - `[low]` `[patch]` The `doc()` test helper's default parameter turned an explicit `undefined` role into `writer`, so absence could not be expressed through the helper. Accepts `null` for absence now, with the trap documented.
  - `[low]` `[patch]` A `promptScaffolds.test.ts` comment claimed the fixture was "exactly the shape getGenerationInput emits" while writing `uploaderRole: undefined`, which `getGenerationInput` never does. Reworded to say it is a hand-built pre-narrowing input and points at the test that pins the real shape.

### 2026-09-04 - Second follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 19: (high 0, medium 4, low 15)
- addressed_findings:
  - `[low]` `[patch]` The demoted-ordering test in `trustedContext.test.ts` compared `indexOf("attributed.md ---")`, which also matches inside `unattributed.md ---`, so the substring check could not tell the two orders apart and only the label-array assertion protected it. Rewrote both ordering checks (and the matching one in `generationAttribution.test.ts`) to locate full `--- BEGIN [LABEL] file ---` markers and to assert each marker is present.
  - `[low]` `[patch]` After a project duplicate, `uploadedBy` names the copier while `uploaderRole` is carried from the origin row, so the two fields can describe different people. Documented that on the `projectDocuments.uploaderRole` schema comment so the next reader does not treat it as a bug.

## Design Notes

The demotion has to move the label, not just the report field, because the label *is* the instruction. `CONTEXT_INPUTS_GUIDANCE` binds trust to the literal category header inside the marker line ("WRITER'S NOTES … HIGHEST TRUST for intent … Where they conflict with the transcript, the writer's notes win"). `report.sources[].trust` is telemetry the model never sees. So the single seam is an effective category computed once per document:

```ts
export function effectiveCategory(doc: ContextDoc): ContextDocCategory {
  return documentTrust(doc.category, doc.uploaderRole) === "internal"
    ? doc.category
    : doc.category === "writer_notes"
      ? "other"
      : doc.category;
}
```

Everything the model sees (sort key, `ANALYZER_CATEGORY_LABELS` lookup) and the report row's `category` read that, so a demoted document is indistinguishable from an ordinary supporting file at every observation point.

Why record rather than join: `projectDocuments.uploadedBy` is `v.string()` and holds `user._id` on the chat-upload path (`documents.ts:146`) but `userDisplayLabel(user)` on the duplicate, port and review-PD paths — three of the four writers store a display name. Joining it to `users.role` at read time would resolve for one path and silently fail for the others, which is exactly the shape of bug that grants trust by accident.

## Verification

**Commands:**
- `npm run check` -- expected: clean; needs `PUBLIC_CONVEX_URL` set to any value.
- `npx vitest run convex/ai/trustedContext.test.ts convex/documents.test.ts convex/generationInput.test.ts convex/ai/promptScaffolds.test.ts convex/generationAttribution.test.ts` -- expected: green, including the new demotion cases.
- `npm test` -- expected: green; no browser involved.
- `git diff --name-only` -- expected: no path under `src/`.

## Auto Run Result

Status: done

**Second follow-up review pass** on the CAP-3 change (baseline `23317ce`, prior commits `470f4d0` and `e3ac2e8`). No intent gaps, no spec defects. Two low-severity patches applied, both test/comment only; no production behavior changed in this pass.

**Implemented change (unchanged).** `writer_notes` earns the analyzer's highest trust only when an internal user uploaded it. The uploader's role is recorded on `projectDocuments` at write time, frozen onto `generationSources` at reservation, and read by `documentTrust`; `effectiveCategory` moves a roleless `writer_notes` document to `other` for the block label, the sort key, and the report row. Fails closed with no backfill.

**Files changed in this pass:**
- `convex/ai/trustedContext.test.ts` - demoted-ordering test locates full BEGIN markers instead of a bare-filename substring that also matched `unattributed.md`.
- `convex/generationAttribution.test.ts` - same tightening on the end-to-end ordering assertion.
- `convex/schema.ts` - comment on `projectDocuments.uploaderRole` records that after duplication it describes the origin uploader while `uploadedBy` names the copier.

**Review findings:** 2 patches applied (0 high, 0 medium, 2 low), 0 deferred, 19 rejected (0 high, 4 medium, 15 low). Rejected items were already tracked in the deferred-work ledger (DW-29 `reviewAgent` raw category, DW-30 invisible demotion and picker copy, DW-31 no non-internal upload path), barred by the intent (`reviewAgent.ts` edits, dedupe-branch backfill, UI), verified false against the source (the reservation test does distinguish stamp-from-requester because the requester is a writer and the fixture stores manager; `buildTrustedContext` is imported in `promptScaffolds.test.ts`; the dedupe branch never un-archives; `getGenerationInput` filters on `kind === "project_document"`), or descriptive/cosmetic (report row `category` reflecting the effective category is the intended "demotion is total" reading; budget-priority consequence is pinned by a test; `documentTrust` deliberately accepts a wide string; changelog is drafted by the pipeline from the day's changes).

**Follow-up review recommendation:** false. Patched findings this pass: 0 high, 0 medium, 2 low; score = 3x0 + 1x2 = 2, below the threshold of 5.

**Verification:**
- `npx vitest run convex/ai/trustedContext.test.ts convex/generationAttribution.test.ts` - 2 files, 66 tests, green.
- `npm test` - 124 files, 1263 tests, green.
- `npm run check` - 5840 files, 0 errors, 0 warnings.
- `git diff --name-only 23317ce` - no path under `src/`; no `api.*` argument shape changed.

**Residual risks:**
- DW-29, DW-30, DW-31 remain open in the deferred-work ledger, owned by the orchestrator. Chiefly: no upload path can produce a non-internal uploader, so the demotion fires only on rows predating the field, and an internal writer tagging a client-supplied file `writer_notes` is indistinguishable by uploader role.
- Demotion moves a pre-CAP-3 `writer_notes` document to the back of the budget queue; pinned by a test, still a live behavior change for existing projects.
