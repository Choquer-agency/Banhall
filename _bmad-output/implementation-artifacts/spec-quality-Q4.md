---
title: 'Q4: Preserve review feedback beside comparison drafts'
type: 'bugfix'
created: '2026-09-05'
status: done
baseline_commit: 0a538c72b41123801198782e08c12d17de9d253f
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/product-domain.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
  - '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CurrentProjectPage shows PD-review feedback only before a comparison report exists. Generating the comparison draft hides the summary and strengthening suggestions that writers still need beside the editor.

**Approach:** Render the existing PdReviewReport supporting panel for review-mode projects with a report, while retaining the existing intake panel and its generation policy.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass`. Preserve current transcript metadata/content split, editor content, generation authority/confirmation, role checks, human proposal application, and source provenance. Use existing design tokens, type roles and Svelte 5 conventions. Scope is feedback presence in the existing supporting area, not a layout redesign. Record evidence under `.audit/quality-pass/Q4/`.

**Ask First:** Any required policy change or redesign beyond the supporting panel requires root escalation; ordinary fixture adaptation and responsive validation are authorized.

**Never:** Copy Cownose's whole component or obsolete singular transcript query; change report prose through AI tools; alter generation/workflow state; edit other checkouts; commit, stage, push, install, or change ledgers. Root owns independent three-lens review and final full gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Comparison report | Review mode, report and completed review | Draft plus filename, summary and suggestions visible together | Existing validated review payload behavior |
| No transcript | Same state, transcript list empty | Existing comparison button remains present and disabled | No generation call |
| Transcript present | Same state, current transcript list populated | Existing generation callback and confirmation reached through real interaction | Existing errors retained |
| Ordinary project | Generate mode with report | No added review panel | No new review query/action policy |
| No report | Existing review intake state | Existing single panel remains; no duplicate feedback | Running/failed/unreadable behavior retained |

</frozen-after-approval>

## Code Map

- `src/lib/components/project/CurrentProjectPage.svelte:1275` supporting panels after report editor is insertion seam; existing intake PdReviewReport is at 1688.
- `CurrentProjectPage.svelte:89` listTranscripts query and line 160 derived metadata list replace historical `transcript`; existing `hasTranscript={transcripts.length > 0}` at 1690 is authoritative.
- `CurrentProjectPage.svelte:695` `handleGenerateFromReview` preserves regeneration confirmation; lines 257–284 preserve human proposal application. These are reuse points, not rewrite targets.
- `src/lib/components/review-pd/PdReviewReport.svelte` owns result validation, status display, timeline and generation controls; reuse it unchanged unless an exact rendering defect requires a narrow adjustment.
- `docs/product-domain.md:401` second 2026-08-11 amendment requires PD editor alongside AI feedback, without workflow coupling.
- Transport/navigation stubs: reset separate auth state as well as Convex/navigation; seed explicit transcript/event arrays. PdReviewReport mounts a review_viewed event, so filter generation mutations when asserting no generation. Any existing report requires confirmation; confirm via Re-run generation with confirmRegeneration:true.
- New `src/lib/components/project/CurrentProjectReviewFeedback.component.test.ts` belongs in current checkout. Historical Cownose test is read-only evidence, not a drop-in fixture.

## Tasks & Acceptance

**Execution:**
- [x] `CurrentProjectReviewFeedback.component.test.ts` — seed realistic current project/report/version/review/transcript APIs; render actual CurrentProjectPage and capture baseline failure finding review feedback while comparison draft is present.
- [x] `CurrentProjectPage.svelte` — add conditional supporting panel for review mode and pdReview, reusing exact current hasTranscript/callback behavior.
- [x] `CurrentProjectReviewFeedback.component.test.ts` — exercise matrix and actual generation control/confirmation interaction; assert absence of calls when unavailable. Avoid text-only success evidence: inspect rendered visible elements and editor text.
- [x] `.audit/quality-pass/Q4/` — save baseline-fail/pass logs, before/after screenshots at 390px and 1440px, evidence.md with actual fixture/runtime limits, with root-owned canonical decision logging.

**Acceptance Criteria:**
- Given comparison content and feedback, when the writer scrolls the existing pane at desktop/narrow width, then both are readable without newly introduced horizontal overflow. Capture default phone chat state, then use the existing close-chat control for the reading state; disclose pre-existing layout limits.
- Given generation confirmation is required, when the supporting panel action is activated, then the existing confirmation appears and no mutation bypasses it.

## Spec Change Log

## Verification

**Commands:**
- Before component source edits, verify root Q2 direct canonical gate evidence proves the current browser baseline. If later source edits invalidate that baseline, rerun the component suite. Root has already run the full baseline before component work.
- `npm run test:component -- src/lib/components/project/CurrentProjectReviewFeedback.component.test.ts` — new test fails against baseline and passes after repair; all matrix cases pass.
- `npm run check` — Svelte/TypeScript checks pass.
- `git diff --check` — clean diff; root owns final full gate and independent review.

## Suggested Review Order

- Reuse the existing feedback panel beside the report.
  [CurrentProjectPage.svelte:1277](../../src/lib/components/project/CurrentProjectPage.svelte#L1277)

- Prove visibility, confirmation, error recovery and reactive review changes.
  [CurrentProjectReviewFeedback.component.test.ts:114](../../src/lib/components/project/CurrentProjectReviewFeedback.component.test.ts#L114)
