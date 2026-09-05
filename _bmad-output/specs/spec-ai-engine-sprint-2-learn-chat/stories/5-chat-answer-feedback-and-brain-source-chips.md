---
title: 'Chat answer feedback and Brain source chips'
type: 'feature'
created: '2026-09-04'
status: done
baseline_revision: d4793b0ac05daad10cd6bdba2e7d617873448db3
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/design-system.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/decisions/digest-diversity-policy-2026-09-04.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Chat hides the Brain references behind model-oriented tool output and offers no persisted per-answer rating for learning.

**Approach:** Show source title/science labels beneath searchBrain steps using Source, reuse the existing FeedbackBar for completed assistant turns, and persist authenticated votes plus server-derived answer context in chatAnswerFeedback. Feed these votes into the draft-style distiller through existing admission mechanics.

## Boundaries & Constraints

**Always:** Follow CAP-7 in touchpoints.md. Reuse src/lib/components/chat/primitives/FeedbackBar.svelte (also used by ResearchFeed). Apply Svelte 5 runes, design tokens/type roles, font weight at most 500 and existing bits-ui primitives. Derive voter, project, report and answer context on the server. Reuse existing internal project access, first-vote-wins feedback convention, and per-user vote identity. Authoritative completed chatTurns anchor ratings; one feedback control per completed turn, never streaming/failed/aborted or orphan proposal placeholders. Preserve vote on remount, show safe retryable errors, prevent duplicate submissions. Apply best-effort project-aware de-identification before firm-wide learning; preserve original records. Independently require two producers and two projects for the new stream, and five admitted records overall; derive prompt, counts, exact IDs, producers and freshness solely from admitted records. Separate admin publication/privacy review and personal isolation remain unchanged.

**Block If:** Implementation requires new permissions, workflow transitions, changing the forbidden modules, or unsupported claims about source identity.

**Never:** Mutate report prose, auto-publish, repurpose projects.createdBy, add another FeedbackBar, expose raw tool/reasoning payloads as sources, invent source links/IDs for string-only results, hand-edit convex/_generated, or edit convex/ai/chatAgentV2.ts, convex/chatV2.ts, convex/ai/analyzerAgent.ts, convex/ai/pipeline.ts, convex/lib/auth.ts, convex/projectWorkflow.ts, convex/ai/qaChecks.ts or convex/reports.ts. Do not alter native deferred-work ledger bytes. No push, PR or deployment.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Brain sources | Successful formatted reference patterns with title/science | Source chips show available title and science labels; body/directives/writer names excluded | Missing metadata never invented |
| Empty/error/malformed | Empty, degraded, failed or unrecognized result | Honest existing status/empty summary; no fake source chips or raw internals | Safe error copy |
| Completed answer | Completed mapped turn and authenticated internal voter | Existing FeedbackBar records +1 or -1; server-derived context and identity stored | Only one record per user/turn |
| Repeat/remount | Duplicate/racing vote or refreshed panel | First vote retained and shown selected; no extra signal | Idempotent |
| Invalid target/access | Anonymous, roleless/client, missing/mismatched thread/report, or noncompleted turn | No feedback read leakage or write | Existing domain error semantics |
| Loading/failure | Feedback loading or mutation rejects | No premature submission; inline safe error, keyboard retry succeeds | No false success |
| Diverse learning | Five admitted chat votes across two voters/projects with meaningful server answer context | Distiller receives sanitized vote/context only; exact provenance/count/cutoff saved on unpublished candidate | No publication side effect |
| Underdiverse/mixed | New stream fails diversity or pooled diversity only, or fewer than five admitted overall | Stream omitted independently, qualifying old streams preserved; skip below five | Omitted rows cannot advance freshness |

</intent-contract>

## Code Map

- `src/lib/chat/turnParts.ts:275`: searchBrain currently summarizes string output. `convex/ai/brain/retrieve.ts:373` formatBrainExemplars writes one header per reference with title, CRA science label and writer label separated by an em dash. No IDs/URLs survive into tool output. Emit an explicit versioned metadata envelope at the start of formatBrainExemplars output using only exemplar title/science fields; parse only that bounded envelope, never scan exemplar bodies for headers. Preserve readable reference formatting and existing safe summaries. Legacy strings without the envelope may retain summaries but must not yield unsupported source metadata. Test the real formatter-to-normalizer path, including forged headers in bodies and titles beginning CRA. No source IDs or URLs are invented.
- `ToolTraceStep.svelte`: detail renderer/disclosure; extend a typed sources detail and render Source wrappers with visible title/science. `primitives/Source.svelte` currently requires href but supports snippet children; allow absent href for informational chips without fake links. Preserve existing linked Source consumers. SourceContent currently has legacy 600 weight; avoid inheriting it or correct touched presentation.
- `AssistantTurn.svelte`: renders trace/artifacts/text/actions. `AgentChatPanel.svelte:343,1264`: listTurns already returns durable turn IDs and joins order to UI messages; use this mapping for feedback and select the final visible assistant answer per turn if multiple message records share an order. New module query supplies current viewer votes over bounded loaded turn IDs/window; no per-token query churn.
- `convex/schema.ts`: chatTurns has agentThreadId/promptMessageId/order/status; agentChatThreads maps thread to report/project. `convex/lib/auth.ts`: requireInternalProjectAccess/getInternalProjectAccessOrNull are hardened read-only reuse points. Research submitFeedback provides first-vote-wins precedent.
- `components.agent.messages.getMessagesByIds` validates the prompt; `listMessagesByThreadId` with upToAndIncludingMessageId includes its order. Filter successful assistant messages to exact turn order and extract text only, never tool or reasoning, with bounded reads/text. Snapshot server-derived context at vote time for stable learning. Check report/project/thread consistency and do not trust client prose.
- `convex/lib/learningAdmission.ts`: admitStream accepts new stream name and summarizeAdmission records exact IDs, producer counts, exclusions and cutoff. `convex/ai/learning.ts:284`: add independently admitted chat stream to draft-style; provider payload only explicit sanitized fields. Existing learningDigest metadata UI renders stream names generically.
- Prior stories implemented CAP-8 lifecycle tests, CAP-1 deidentify/publication confirmation, CAP-2 PED storage, and CAP-4 admission/provenance. Preserve their protections and orchestrator-owned deferrals. Real codegen repaired prior generated API issues; never repeat historical hand-edit guidance.
- Browser operational recovery (2026-09-04): the paused worker still failed canonical startup after its own Svelte sync. Its parent learning checkout lacked `.svelte-kit/tsconfig.json`; running `npx svelte-kit sync` in that parent allowed the unchanged worker canonical full browser suite to pass (335 tests, 54 files). Parent and worker generated Svelte configuration now exist. Run the unmodified canonical browser command for acceptance; an audit wrapper is diagnostic evidence only, not a replacement gate. Never add sveltekit() to the browser test config.

## Tasks & Acceptance

**Execution:**
- `convex/chatFeedback.ts`, `convex/schema.ts`: preserve bounded raw original context and a separate learning snapshot deidentified before truncation at vote time using the then-current project metadata; digest reads the sanitized snapshot so renames/deletion cannot expose original identifiers. Add migration-safe optional snapshot fields and omit historical rows without reliable snapshots. Test renamed/deleted projects and identifiers crossing truncation boundaries. Implement validated vote storage and guarded bounded viewer query, internal sanitized learning query, indexes, first-vote idempotency and server context extraction.
- `convex/ai/learning.ts`: add chatAnswerFeedback stream, weak-vote context guidance, and explicit provider payload while retaining all existing admission/freshness/privacy controls.
- `convex/ai/brain/retrieve.ts`, `src/lib/chat/turnParts.ts`, `ToolTraceStep.svelte`, `primitives/Source.svelte` and source context as needed: normalize the explicit bounded metadata envelope and render source chips through the existing primitive without invented links. Give the source collection a named group role; verify unbroken maximum-length labels cannot overflow at mobile width. Avoid full tool normalization merely to determine textual answer eligibility during streaming updates.
- `AssistantTurn.svelte`, `AgentChatPanel.svelte`: wire existing FeedbackBar to completed turn, guarded query and mutation state with persistence, safe errors and retry. A small binding component/helper is acceptable, but no second FeedbackBar primitive.
- `convex/chatFeedback.test.ts`, `convex/learning.test.ts`, `src/lib/chat/turnParts.test.ts`, new `src/lib/components/chat/*.component.test.ts`: cover every matrix row, real component browser interactions and actual backend functions with convex-test/agent component. Exercise the outer AgentChatPanel wiring as well as presentation; mock external provider/network only. Cover duplicate turn messages, both votes, remount, unauthorized scope, mutation failure, source metadata, and sanitized admitted/omitted learning payloads. Add distinct opposite persisted votes across multiple answers with an unrated third answer; delayed mutation duplicate-click suppression; query-error safe page-remount recovery; and viewer/thread changes while a mutation is pending. Keep browser network stubs at the external boundary and actual Convex handler tests for persistence.
- `.audit/CAP-7-story-5/decisions.tsv`, `evidence.md`: append decisions and retain exact commands/output, AC mapping, full revision IDs, protected-file/ledger hashes, and real before/after UI screenshots. Baseline browser output already retained. Use real supported Convex codegen for API types if needed and retain evidence. Commit reviewed work only in this worktree at finalization; no ledger editing.

**Acceptance Criteria:**
- Given a completed answer grounded by searchBrain, when the writer opens its trace in the chat panel, then title/science source chips are visible and tool bodies are not shown as source metadata.
- Given eligible turns, when a writer rates an answer and remounts the panel, then the same selected vote remains visible and the actual mutation persisted exactly one server-attributed feedback record.
- Given the matrix inputs, when actual digest actions execute and admin history is queried, then prompt payload, provenance, exclusions and publication state match the existing approved policy.
- Given the final patch, when backend, browser-mode component and type/Svelte checks execute, then they pass; forbidden files and native ledger bytes remain unchanged.

## Spec Change Log

- 2026-09-04: Record verified environment recovery, require canonical full browser acceptance, and preserve the unreviewed candidate as reference for a normal native re-drive. Product intent and approved diversity/publication policy are unchanged.


- 2026-09-04: Review repair 1: whole-output header scanning could promote exemplar body lines to source chips. Amend the formatter/parser plan to an explicit versioned metadata envelope anchored at output start, with honest fallback for legacy output. Also make redaction snapshots stable across project changes and apply redaction before text limits; strengthen browser edge-state coverage. Known-bad state avoided: body-derived source labels and truncation/stale-metadata privacy leakage. KEEP: existing FeedbackBar/Source reuse, exact completed textual turn mapping, server authority and first-vote idempotency, independent diversity/freshness/provenance controls, all passing regression coverage, supported codegen, protected modules and native ledger bytes.

## Review Triage Log

### 2026-09-04 Review pass 1
- intent_gap: 0
- bad_spec: 1: (high 0, medium 1, low 0)
- patch: 11: (high 0, medium 8, low 3)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[bad_spec]` Replaced the whole-output header parsing plan with an explicit metadata boundary and real formatter integration coverage; re-derive implementation with the KEEP instructions in the Spec Change Log. Lower findings are included as planning safeguards for re-derivation.


### 2026-09-04 Review pass 2
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` Bound new-stream database reads to the newest 20 records; preserve full snapshots and test maximum Unicode records.
  - `[medium]` `[patch]` Bound provider excerpts to 500 prompt and 1,000 answer characters; verify identical selected-record provenance, counts and freshness.
  - `[low]` `[patch]` Preserve industry-scoped empty-search meaning using fixed safe copy.
  - `[low]` `[patch]` Verify query-error recovery by unmounting and reopening the actual panel.
  - `[low]` `[patch]` Associate each reused feedback pair with its answer using a stable labelled group; verify distinct associations.


### 2026-09-04 Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` Correct query-error guidance to refresh the page; closing and reopening chat does not remount it. Align the browser remount assertion with the actual recovery requirement.
  - `[medium]` `[patch]` Preserve Unicode code points at raw and sanitized snapshot limits, with a regression demonstrating the old split character.
  - `[low]` `[patch]` Move routine screenshots to ignored test attachments and preserve the existing committed audit image.
  - `[low]` `[patch]` Exercise the installed Convex query hook and actual subscription cleanup during streaming updates.


### 2026-09-04 Follow-up review pass 2
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 8
- addressed_findings:
  - `[low]` `[patch]` Preserve whole Unicode code points in bounded source labels and validate the same limit in the parser; the formatter-to-normalizer regression fails before the fix and passes afterward.
  - `[low]` `[patch]` Exercise four-byte supplementary characters in the maximum-size learning snapshot fixture and retain the bounded provider payload assertion.
  - `[low]` `[patch]` Add a revision-specific reviewed-file manifest including the subscription test and harness.
  - `[low]` `[patch]` Label earlier evidence as historical and identify this invocation's current receipt.


## Design Notes

A rating indicates response usefulness, not permission to learn client facts or a precise critique. Include bounded server answer context with the vote, require recurring support, and allow no supported rules. Keep informational source chips readable without suggesting a destination the stored result cannot supply. No schema backfill is required; historic missing turn metadata remains ineligible rather than fabricated.

## Operational Recovery Notes

Review pass 1 implementation is preserved in `.audit/CAP-7-story-5/review.diff`; it may be assessed and reused selectively during re-derivation, excluding its historical story diff. All product changes were reverted before this loopback. Keep the original baseline `d4793b0ac05daad10cd6bdba2e7d617873448db3`.


The missing-codegen-configuration escalation is repaired without changing product intent. Authorized, ignored `.env.local` is provisioned to the native project and seeded into new workers. Do not print, commit, or copy its values into evidence. Supported `npx convex codegen --typecheck disable` succeeded in the paused worker and produced the new generated API registrations. Backend TypeScript and Svelte check then passed with zero errors or warnings. Never hand-edit generated declarations or deploy as part of this story.

The prior implementation is preserved for reuse and review at `codex/preserve-learning5-codegen-recovery-20260904` (`44b702478781d278d8f7626285d55ec9dbb4a5cf`, parent `36313c0ac79fbd408fe121958f0af759ab7e964c`). This is an unreviewed recovery checkpoint, not accepted work. The native clean re-drive starts from the pinned target, captures its actual baseline in step 03, and may inspect/reuse the candidate implementation after assessing it against this complete plan. Do not merge the preservation branch into the baseline, import its historical blocked spec over this plan, skip implementation/review, or set a restored-patch latch. Review the entire feature diff against the new native baseline and execute all current gates before finalization.

Original attempt evidence and operational before/after command receipts are retained at `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/.audit/learning5-codegen-recovery-20260904/`; `worker-audit-before/` contains the original feature test matrix, screenshots and protected-file hashes. Reuse these as history, and retain fresh final evidence in this worker. Original 102 focused and 1,890 nonbrowser tests were passing; real codegen, backend checks and 335 canonical Chromium tests also passed during operational recovery. Those results do not constitute native acceptance or independent review.

## Verification

**Commands:**
- `npx vitest run convex/chatFeedback.test.ts convex/learning.test.ts src/lib/chat/turnParts.test.ts`: matrix/backend/admission cases pass.
- `npm run test:component`: the complete canonical Chromium component suite passes, including ChatFeedback.component.test.ts. Preserve any failure and diagnose it; do not substitute an audit wrapper for this acceptance gate.
- `npx tsc -p convex/tsconfig.json --noEmit`: no errors.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: zero errors/warnings.
- `npm test`: full nonbrowser suite passes; document host-load failures and command-local timeout rerun if needed.
- `git diff --check`: clean; compare baseline hashes for forbidden modules and native ledger.



## Follow-up Review Notes

The project shells hide chat without unmounting it. Query-error guidance now asks for a page refresh, which recreates the subscription; the browser remount test models that lifecycle and does not claim that toggling chat visibility retries the query. Snapshot limits count Unicode code points so a boundary cannot split a supplementary character. Routine component screenshots go to ignored test output, preserving the committed audit capture.

## Auto Run Result

Status: done

Completed the supplied done-story follow-up review against baseline `d4793b0ac05daad10cd6bdba2e7d617873448db3`. The feature retains persisted, server-attributed completed-turn feedback, bounded Brain source chips, and independently admitted sanitized chat learning. This pass fixes Unicode source-label truncation and strengthens maximum-size snapshot coverage.

Files changed in this pass:
- `convex/ai/brain/retrieve.ts`: truncate source labels by whole code points.
- `src/lib/chat/turnParts.ts`: enforce matching code-point metadata limits.
- `src/lib/chat/turnParts.test.ts`: reproduce and prevent the source-title Unicode boundary failure.
- `convex/learning.test.ts`: test four-byte maximum-size snapshots and bounded provider excerpts.
- `.audit/CAP-7-story-5/`: current review manifest, protected-byte receipt, command archive, decisions, and evidence.
- This story: review triage and final status. Full feature changed-file inventory is in `review-20260904-files.json`.

Four review layers completed. Deduplicated findings: 4 low patches applied, 0 deferred, 8 rejected; no intent gap or bad spec. Follow-up score: high 0, medium 0, low 4; score 4, recommendation false.

Verification: focused suite 114 passed; canonical browser suite 347 passed across 55 files; full nonbrowser suite 1,902 passed across 149 files; Convex TypeScript passed; Svelte check zero errors and warnings; diff whitespace check passed. The new regression failed on the pre-fix source and passed after the fix. All forbidden files and native ledger bytes equal baseline. Product-code commit: `3984aef268934915def678b969942756f7ac790d`.

Residual evidence limits: browser transport is controlled and backend persistence/digest actions are separately exercised with convex-test. Page-refresh recovery is modeled through actual panel unmount/remount. No live provider or deployment claim is made. No ledger entries were authored, reopened, rewritten, or staged.
