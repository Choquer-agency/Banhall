# Cownose working-change assessment

Read-only comparison of 14 frozen modified/new files at cownose HEAD c7167fb59d3eb46b7a21aafbad6a292ed25ea0df with current origin/main cc6b706c3b43f971d944cb703a4174eabf3134d9. Local branch main is stale and was not treated as current main. No source edits, git mutations, merges, commits, tests, deployments or workers were started. Convex generated AI guidelines, TypeScript practices and relevant domain amendments were read. Current snapshot recheck found no changed source bytes during inspection.

`manifest.json` contains SHA-256 identities; `snapshot/` contains all 14 exact files. `head.patch` captures tracked changes from cownose HEAD; `untracked.patch` captures the new test. `main.patch` captures tracked working-tree differences from current main, including main's intervening work, so it is comparison evidence and must not be applied as a feature patch. No file is byte-identical to main, but byte inequality does not mean its behavior is missing.

## Batches and disposition

### 1. Stale PD review recovery: already incorporated with a newer contract

Files: convex/crons.ts, convex/pdReviews.ts, convex/schema.ts.

Cownose adds a bounded indexed sweep of 100 running reviews, timeout failure event and completion timestamp, running every ten minutes with a 30-minute cutoff and a numeric return. Main already implements this at convex/pdReviews.ts:308 and convex/crons.ts:18, with the same index at convex/schema.ts:1718, a 15-minute cutoff and `{ failed }` return. Main also has `pdReviewProjection.test.ts:90` and `reaperIntegration.test.ts:28` coverage for sweep and retry behavior. Do not port the duplicate implementation: it would lengthen recovery, break the result shape or duplicate exported functions/cron names. No missing intent here unless the owner explicitly wants the timeout policy changed, for which this historical patch is not evidence of current approval.

### 2. Copied running PD reviews: outstanding narrow behavior

File: convex/projects.ts.

Cownose converts copied `running` rows to `failed` with an explanatory retry message because copying does not schedule a corresponding review action. Main's copy routine still writes `status: review.status` at convex/projects.ts:959; its existing cron eventually recovers the copied row, so the issue is a needless 15-minute-plus sweep wait, not an indefinite running state on current main.

A port must preserve main's new revisionNumber/contentHash provenance fields (projects.ts:953-958), transcript-set copying, and current project access contract. The old entire file would discard substantial intervening work. The cownose hunk does not set completedAt for a newly failed copied running row and does not emit a review_failed event; decide whether the copied-record semantics should mirror the ordinary terminal-state audit or deliberately preserve provenance. Never repurpose createdBy or alter human workflow stage as part of this repair.

Intended acceptance: copied running review is immediately retryable; source remains running; completed/failed rows and revision/hash values (including zero/empty values) preserve their provenance; normal copy authorization remains enforced. Existing main projects.test.ts:345-425 covers completed review and provenance copying, but this inspection found no running-copy case. Runtime behavior has not been tested here.

### 3. Current project review feedback: outstanding display repair, old fixture needs adaptation

Files: CurrentProjectPage.svelte and new CurrentProjectReviewFeedback.component.test.ts.

The added supporting panel keeps PdReviewReport visible when a review-mode project has a generated comparison draft. Main still renders this report only in its no-report branch at CurrentProjectPage.svelte:1688; its generated-report supporting panels at :1275 omit it. Domain 2026-08-11 second amendment (product-domain.md:401-408) explicitly requires the PD editor alongside AI feedback, so this aligns with existing intent.

Port only the panel and adapt `hasTranscript`: main uses transcript metadata array (CurrentProjectPage.svelte:160), not the removed singular `transcript` variable used in the cownose hunk. The new test seeds removed `transcripts:getTranscript` and a report `revision` field; refresh its fixture for main's transcript list/content and report version shape before treating it as executable evidence. Preserve current generation authority and human-applied proposal boundaries; merely displaying the panel must not bypass the existing generate callback.

Intended acceptance: comparison draft text, source PD filename, review summary and strengthening suggestions appear together for review mode; ordinary generate-mode projects do not gain the panel; transcript/no-transcript generation affordance remains truthful. The historical new test checks only text presence, not responsive visibility, so it does not prove the full editor layout.

### 4. Model score row identity: outstanding defensive repair

File: ModelTestSummary.svelte.

Cownose replaces `row.optionPosition` key with a position/label/index composite. Main still keys solely on optionPosition at ModelTestSummary.svelte:35. Main's getCandidateScoreSummary already filters to the caller's own scores (convex/generations.ts:3125), fixing cross-user duplicate positions, but scoring still accepts caller-supplied optionPosition and upserts per user/candidate (generations.ts:3065). Two different candidates of the same user's generation can therefore retain the same position; the composite avoids a duplicate-key mount error. This narrower residual case is not eliminated by the existing backend filter.

Intended acceptance: two same-user candidate rows with equal optionPosition render once each, retain correct model/score/chosen labels, and survive score or ordering updates. The proposed index-based key is adequate for a stateless table, but exposes no stable row identity across reorders; returning a score/candidate ID is a possible larger change and should not be silently added. No regression test accompanies this hunk, and no runtime proof was produced here.

### 5. Navigation: avatar Settings is separate from superseded rail intent

Files: UserMenu.svelte, UserMenu.component.test.ts, WorkspaceRail.svelte, WorkspaceRail.component.test.ts, layout.css.

Cownose restores a Settings menu entry to the legacy avatar; current main's avatar still contains identity/sign-out only (UserMenu.svelte:180). However, main has redesigned rail mode as a standalone confirmed sign-out control, with persistent Settings in WorkspaceRail.svelte:353. Do not copy the old whole menu or reinstate its rail dropdown, which would regress current focus/confirmation behavior and drawer tests. Cownose's comment cites the all-roles Settings capability but does not itself establish that the old app-bar shell is currently unreachable or that its navigation should be changed. If desired, restore only the avatar entry and validate real navigation to /settings; the historical test only checks body text and does not prove selection/navigation or all-role reachability.

The developer-only rail comments and nondeveloper missing-row expectation are superseded. Current domain 2026-08-19 (product-domain.md:1264) explicitly says Flag issue in the rail is visible to all users; main implements this at WorkspaceRail.svelte:315-326 and tests nondeveloper presence. Cownose layout.css changes floating-button suppression from mounted shell to actual rail-row presence, but its stated defect rationale assumes the obsolete developer-only rail. Main already supplies the all-user flag path. Do not reintroduce the old role restriction or stale comments. A selector change would need its own demonstrated remaining defect; this audit established none.

Human intent boundary: ownership of these uncommitted files remains pending. The avatar Settings addition is a distinct navigation decision from preserving the existing rail; the current approved all-user flag rule is not an open choice unless the user explicitly amends it.

### 6. Header and rail test corrections: already superseded by stronger checks

Files: WorkspaceHeader.component.test.ts and WorkspaceRail.component.test.ts.

Cownose updates a stale py-2.5 assertion to h-8 and duration-300 to duration-150. Main's header now tests actual 32px height at 390/1440 widths (WorkspaceHeader.component.test.ts:161), while rail tests real computed 0.15s transition, reduced-motion suppression and 28/44px geometry (:219 onward). Main's rail implementation is already 150ms. Porting historical tests would reduce meaningful current coverage. The comment-only rail edits are covered in batch 5.

### 7. Original-file upload reliability: outstanding shared helper change

File: src/routes/project/new/+page.svelte.

Cownose retries raw storage upload twice, requests a fresh URL per attempt, rejects HTTP errors, bounds each POST with AbortSignal.timeout(120000), and warns when review PD original bytes fail but extracted text remains available. Main's uploadOriginal at :482 still has one attempt, no HTTP-status guard/deadline, and silently returns undefined; the review upload at :734 still proceeds without the warning. The helper also serves non-review original uploads, so retry behavior affects more than PD reviews.

Risks/limits: generateUploadUrl itself is outside the POST timeout, so the comment that the whole commit cannot hang is too strong; two failed POSTs can take four minutes; a successful upload with a lost response can leave orphaned bytes when retried; response JSON remains an unchecked cast; AbortSignal.timeout compatibility must match supported browsers. Preserve main's newer upload attempt/outbox handling, request IDs and transcript-set flow. Do not copy the historical wizard wholesale.

Intended acceptance: transient POST failure followed by success attaches originals; non-2xx responses cannot be accepted as storage IDs; repeated failures produce the promised review warning while extracted text still reaches review; fresh URL per attempt; stalled POST aborts; unchanged successful upload path and upload-attempt recording. No new tests accompany the old hunk. Verify whether re-uploading through Files actually fulfills the recovery wording before making that promise.

## Historical feedback probe

The untracked feedbackReadLimit.probe.test.ts is a deliberate old-failure diagnostic, not a missing green regression. It creates 49 historical 180k-character prompts, proves the latest answer is visible, expects submitFeedback to throw Read too much data, deletes history, then expects success. Adding it unchanged to main would require the defect to remain.

Main counterpart `convex/chatFeedbackReadLimits.test.ts:42` uses the same 49-by-180k fixture with transaction limits enabled and expects successful feedback without deleting history; it checks the stored latest answer ID and text. Main additionally tests 99/100 nontext boundaries, byte limits, wrong-turn continuation and merged tool/non-tool streams. `convex/chatFeedback.ts:49-77` anchors to the target prompt and bounds the page reads. The probe's behavior is therefore already preserved as a positive regression; retain the diagnostic as historical evidence only, pending owner disposition. Exact probe and main counterpart snapshots/hashes are in this folder. No suite was rerun.

## Boundaries

This is a static analysis of frozen code and current main, not runtime verification, a permission grant, or a decision to incorporate another task's files. Keep source untouched until ownership is resolved. Product authorizations found in domain text do not authorize overwriting another task's working state. Independent committed-branch audits cover other branch changes.
