# PSOS-49 — Per-writer house-style overrides for PD generation

## Work control

- **Status:** `in_review`
- **Phase:** P12 — August 23 writer feedback
- **Current owner:** Claude Code implementation pass
- **Started:** 2026-08-24
- **Completed:** 2026-08-24
- **Source:** Writer feedback 2026-08-23 (lrinaldo@banhall.com)
- **Progress note:** Implemented and recorded as the 2026-08-24 product-domain amendment. Acceptance evidence/QA underway; save-time conflict linting of writer free text is an explicit follow-up, not part of this ticket.

> Documentation-first closure: the two-tier writing standard is a domain contract change and lives in `docs/product-domain.md` (2026-08-24 amendment), not only in code.

## Problem

The PD generation pipeline enforced one monolithic writing standard. A writer's "PD Writing Customized Settings" document (lrinaldo@banhall.com, project `k972k8w75nbq658480fe577h6n8d0ve2`) was silently overridden: their structural, opener, and density preferences lost to the built-in house-style prompt text and to programmatic enforcement (banned-word scrubbing, repetition caps, opener detection), with no way to waive any of it. The industry pattern (Writer.com, Grammarly Business, legal playbook tools) is tiered rules with per-rule overrides and surfaced conflicts, and prompt-hierarchy guidance from Anthropic/OpenAI says to resolve conflicts at prompt assembly, not delegate them to the model.

The CRA-compliance tier (three-line skeleton 242/244/246 and paragraph roles, passive-vs-active uncertainty, because-clause in 242 P5, if/then hypothesis with measurable then-clause, knowledge-first 246, line/word limits, no-fabrication/[GAP]) must remain locked and never overridable.

## Current code

- `shared/styleOverrides.ts` — canonical five-category list (`bannedWords`, `paragraphDensity`, `sentenceConstruction`, `repetitionCaps`, `openingClauses`) and normalization (legacy/absent → all-false).
- `convex/lib/styleOverrides.ts` — server-side helpers.
- `convex/ai/prompts.ts` — prompt builders omit waived category blocks at assembly time.
- `convex/ai/qaChecks.ts` — banned scan, repetition count, and CRA opener detection report `WAIVED` for waived categories.
- `convex/ai/pipeline.ts`, `convex/ai/iterative.ts` — `scrubBannedWords` skipped on `bannedWords` waiver; `buildStyleGuidance` consumes overrides.
- `convex/ai/qaAgent.ts` — QA agent instructed not to deduct for waived categories while still verifying underlying CRA content.
- `convex/ai/postQa.ts`, `convex/research.ts`, `convex/ai/chatAgentV2.ts` — remaining scrub/enforcement call sites honor the waiver.
- `convex/writerProfiles.ts`, `convex/schema.ts` — optional `writerProfiles.styleOverrides` field and mutations.
- `convex/generations.ts` (`getIterativeSectionInput`) — overrides frozen at generation start in the generation artifacts JSON; ghost comparison draft receives the same overrides.
- `src/routes/settings/writing/+page.svelte`, `src/routes/admin/users/+page.svelte` — toggle UI (writer self-serve; admin on behalf).

## Product outcome

A writer (or an admin on their behalf) can waive any of the five house-style categories on their enabled writer profile. Waived categories drop out of drafting/QA/chat prompts and programmatic enforcement for that writer, QA reports them as `WAIVED` without deducting, and the writer's free-text instructions become authoritative for waived categories (lowest priority elsewhere). The locked CRA-compliance tier is untouched: only literal phrasing/density/vocabulary is freed — limitations must still be stated, hypotheses still if/then, advancements still knowledge-first, limits still enforced.

## Acceptance criteria

- [ ] Drafting prompts omit the rule blocks of waived categories (conflict resolved at prompt assembly, not delegated to the model).
- [ ] `scrubBannedWords` is skipped on a `bannedWords` waiver across all five call-site families: pipeline, iterative, compression, chat edit tools, research proposals.
- [ ] QA checks report `WAIVED` for waived categories and the QA agent does not deduct for them, while still verifying the underlying CRA content requirements.
- [ ] Toggles take effect only when the writer profile is enabled; disabled profiles behave as all-false.
- [ ] Legacy `writerProfiles` rows (no `styleOverrides`) normalize to all-false with behavior identical to before this change.
- [ ] Settings page (writer self-serve) and `/admin/users` (admin on behalf) expose the five toggles under the existing profile-edit permission model.
- [ ] Overrides are frozen at generation start for iterative section runs and the ghost comparison draft receives the same overrides.
- [ ] Tests green: `shared/styleOverrides.test.ts`, `convex/ai/prompts.test.ts`, `convex/ai/qaChecks.test.ts`, `convex/writerProfiles.test.ts`, pipeline `buildStyleGuidance` coverage.

## Dependencies and boundaries

- **Dependencies:** none. Widen-only optional field; no backfill; existing profile-edit authorization reused.
- **Out of scope:** save-time conflict lint UI for the writer's free-text instructions; per-project overrides; custom section skeletons; admin-only gating of the toggles; per-writer learning digests (the global `draft_style` digest stays global — the prompt states writer waivers outrank it for waived categories).
- **Known residual tensions (recorded in the 2026-08-24 amendment):** the locked CRA-verbiage presence check still expects terms like "technological uncertainty", so a custom document banning those exact terms conflicts by design; the learning digest is not per-writer; conflict linting is a follow-up.

## Reporter evidence

- lrinaldo@banhall.com (2026-08-23): the built-in three-paragraph skeleton conflicts with their "PD Writing Customized Settings" document, which prescribes a different paragraph structure for the same sections.
- Sections 1–3 of their settings document — structural layout, opening-clause phrasing, and paragraph-density rules — were auto-overridden by the system prompt with no notice to the writer.
- The writer expected their customized settings to govern where they conflict with house style, and asked why the system silently discarded them instead of surfacing the conflict.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-08-24 | Toggles are writer-settable (plus admin on behalf), not admin-gated. | Same permission model as existing profile editing; the waiver only relaxes house style, never CRA compliance. | Product owner |
| 2026-08-24 | `openingClauses` is waivable as phrasing only; the paragraph's content requirements stay locked. | Frees the literal CRA-opener wording without weakening the compliance tier. | Product owner |
| 2026-08-24 | Overrides freeze at generation start for iterative section runs (stored in generation artifacts JSON). | Mid-run toggle changes must not produce mixed-standard sections; ghost draft gets the same overrides for a fair comparison. | Product owner |
| 2026-08-24 | Because-clause (242 P5), three-line skeleton, and CRA length limits are never waivable. | They are CRA-compliance content rules, not house style. | Product owner |
