---
title: 'Digest diversity gate and signal provenance'
type: 'feature'
created: '2026-09-04'
status: 'blocked'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/product-domain.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Firm-wide learning currently admits one writer's feedback from one project and stores only an aggregate source count. Administrators cannot inspect the exact signals or each producer's contribution.

**Approach:** Require at least two distinct writers and two projects per source stream for QA calibration and drafting-style digests. Persist signal IDs and per-producer counts on learningDigests and display them on the admin reviews page.

## Boundaries & Constraints

**Always:** Preserve meaningful-signal filters, the five-row aggregate minimum, freshness deduplication, immutable candidates, administrator publication, privacy review, and personal-digest isolation. Read CAP-4 in touchpoints.md. Attribute feedback to its producer, never projects.createdBy or the administrator approving feedback. Keep client identifiers out of firm-wide prompt content.

**Block If:** The contract does not determine what happens when one contributing stream qualifies and another fails diversity. This condition is present at planning time.

**Never:** Auto-publish guidance, mutate report prose, hand-edit generated APIs, change project authority, or edit the parallel boundary epic's forbidden files.

</intent-contract>

## Code Map

- `convex/ai/learning.ts:31`: MIN_FEEDBACK_ROWS is five; each query uses a 500-row window.
- `convex/ai/learning.ts:116`: generateQaCalibrationDigest filters cleared feedback, checks row count and freshness, distills, then saves.
- `convex/ai/learning.ts:213`: generateDraftStyleDigest combines candidate comments, section edits, proposal wording edits, and approved writer feedback before the aggregate minimum and freshness checks. This is where the unresolved mixed-stream policy changes visible behavior.
- `convex/learning.ts:31`: getFeedbackForDigest currently omits row ID, project, and producer. qaItemFeedback.userId identifies the producer.
- `convex/learning.ts:51`: getCandidateFeedbackForDigest similarly omits provenance; candidateScores.userId identifies the producer.
- `convex/learning.ts:75`: getProposalWordingEditsForDigest de-identifies text using the project record. Preserve that behavior while retaining source metadata separately.
- `convex/learning.ts:100`: getSectionEditsForDigest excludes editRatio below 0.05. sectionEditEvents.userId is optional in the schema.
- `convex/learning.ts:129`: getApprovedBrainFeedbackForDigest admits approved, promotable feedback and derives freshness from the approval audit event. Producer is brainFeedbackQueue.fromUserId, not the reviewer; projectId is optional.
- `convex/learning.ts:214`: saveDigest freezes compatibility publication and deduplicates candidates by cutoff. getDigestHistory explicitly projects fields, so stored provenance also needs inclusion there.
- `convex/schema.ts:1701`: learningDigests has aggregate sourceCount but no input IDs or producer counts. Schema and tests support historical and personal records.
- `src/routes/admin/reviews/+page.svelte:202`: published QA metadata; analogous history and style surfaces at 244, 292, and 334.
- `convex/learning.test.ts:539`: real digest action with mocked Anthropic transport and freshness assertions. Existing projectless, single-writer approval success must change under CAP-4.
- `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: existing browser-mounted page fixture for both digest kinds and publication controls.

## Tasks & Acceptance

Implementation has not been dispatched because the ready-for-development gate failed on the policy question below. These are the identified work surfaces, not an approved implementation plan.

**Execution:**
- `convex/learning.ts`: retain source IDs and producer/project attribution in digest inputs; persist provenance and expose it in history while retaining governed publication.
- `convex/ai/learning.ts`: apply the resolved per-stream gate before model use; derive sourceCount, cutoff, and stored provenance from the exact admitted inputs.
- `convex/schema.ts`: add bounded provenance compatible with existing digest rows.
- `src/routes/admin/reviews/+page.svelte`: show source IDs and producer counts for current and historical digests, with explicit unavailable metadata for legacy rows.
- `convex/learning.test.ts`: verify one-writer and one-project refusal, no cross-stream pooling, the resolved mixed-stream policy, exact provenance, freshness, and publication invariants.
- `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: verify rendered provenance and legacy display while preserving publication controls.

**Acceptance Criteria:**
- Given feedback from one writer across two projects, when either digest generator runs, then it cannot save a digest from that stream.
- Given feedback from two writers on one project, when either generator runs, then it cannot save a digest from that stream.
- Given admitted diverse inputs, when a digest is saved and an administrator views its history, then exact signal IDs and per-producer counts are available.
- Given a published digest, when a new candidate is generated, then publication remains unchanged until administrator selection.

## Spec Change Log

## Review Triage Log

No implementation review ran; planning stopped before the ready-for-development gate.

## Design Notes

The existing generator pools all four drafting streams. Two defensible implementations satisfy the threshold wording while producing different results:

1. Require every present stream to pass; any under-diverse stream prevents the whole candidate.
2. Exclude under-diverse streams and generate from qualifying streams, provided admitted inputs still meet the aggregate minimum.

Concrete counterexample: six candidate comments from two writers and two projects, plus one section edit from one writer and one project. Option 1 saves nothing; option 2 can save a candidate based on the six comments. SPEC.md CAP-4 and the architecture companion do not choose between them. The treatment of projectless approved feedback and unattributed legacy section edits should be stated with this decision; neither missing identity may count as a distinct writer or project.

## Verification

No build or test commands ran. Production files are unchanged. The operator-requested worker-local dependency repair is recorded separately in the audit evidence.

## Auto Run Result

Status: blocked
Blocking condition: intent gap
Baseline observed: b99f1eeef78348df5c14f68031f7f0276527ff3f

Unanswered decision: when one drafting stream qualifies and another does not, should generation stop entirely or omit the failing stream and generate from the qualifying inputs?

Evidence: SPEC.md:38 requires two distinct writers and projects per source stream; docs/ai-architecture-plan.md:273 requires diversity generally; convex/ai/learning.ts combines four independently populated streams. No inspected contract specifies the mixed-stream outcome. Independent read-only investigation also identified both interpretations.

The rendered bmad-build-auto step-02-plan.md instruction 5 requires an intent-gap halt for multiple defensible readings with observably different outcomes. No policy was invented, no implementation was dispatched, and no production code or generated API was changed.

Environment repair completed: `npm ci --no-audit --no-fund` exited 0 and added 601 packages. npm reported pending install-script approvals for esbuild and fsevents; details are in `.audit/CAP-4-story-4/npm-ci.log`. No standalone build or test commands ran.
