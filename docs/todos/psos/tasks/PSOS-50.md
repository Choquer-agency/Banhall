# PSOS-50 — House-rule governance modes and instruction analysis

## Work control

- **Status:** `in_review`
- **Phase:** P12 — August 23 writer feedback
- **Current owner:** Claude Code implementation pass
- **Started:** 2026-08-24
- **Completed:** 2026-08-24
- **Source:** Product owner direction 2026-08-24 (follow-on to PSOS-49)
- **Progress note:** Implemented on top of PSOS-49 and recorded as the second 2026-08-24 product-domain amendment. Acceptance evidence/QA underway; in-app banned-word term editing is an explicit follow-up (candidate PSOS-51), not part of this ticket.

> Documentation-first closure: the governance-mode contract and the new precedence order live in `docs/product-domain.md` (2026-08-24 PSOS-50 amendment), not only in code.

## Problem

PSOS-49 made the five house-style categories per-writer waivable, but the organization had no say beyond the default: admins could not enforce a category against writer waivers, could not turn a category off for everyone (including users with no writer profile and legacy generation paths with no recorded requester), and could not even see the house-rule texts or the locked CRA tier anywhere in the product — the rules lived only in prompt-builder source. Writers, in turn, had to hand-hunt the right checkboxes to make their pasted instructions effective. The lrinaldo feedback and product owner direction (2026-08-24) call for the Grammarly Business locked-preferences / Writer.com org-style-guide pattern: org-level modes over per-writer toggles, rules visible in-app, and save-time analysis that suggests the right waivers.

## Current code

- `shared/styleOverrides.ts` — `normalizeHouseRuleModes` + `resolveEffectiveOverrides`; missing/malformed config always degrades to `writer_choice`.
- `shared/houseRules.ts` — house-rule prompt texts moved verbatim (`HOUSE_RULE_TEXTS` + `LOCKED_RULES` catalog).
- `convex/houseStyle.ts` — `getConfig` (admin query), `getModesForMe` (authed query), `setModes` (admin mutation); modes stored as JSON in `appSettings` key `houseStyle.modes`.
- `convex/writerProfiles.ts` — `getProfileForGeneration` now accepts an optional `userId` and returns **effective** overrides; all generation/chat/QA consumers inherit the resolution.
- `convex/research.ts` — resolves effective overrides the same way.
- `convex/generations.ts` — iterative generations freeze the effective value at start, as in PSOS-49.
- `convex/ai/styleAnalysis.ts` — `analyzeMyInstructions` action: classifies pasted instructions against the five categories, suggests/pre-ticks waivers, quotes locked-tier conflicts.
- `src/routes/admin/house-rules/+page.svelte` — new admin page: locked CRA tier, full rule texts, per-category mode controls, read-only banned-word tables.
- `src/routes/settings/writing/+page.svelte` — "Analyze my instructions" flow with a ✓/–/🔒 report; `enforced` toggles render locked-unchecked ("Managed by your organization"), `off` render locked-checked ("Disabled for everyone").

## Product outcome

Admins govern the five waivable house-style categories org-wide: `writer_choice` (default — exactly PSOS-49 behavior), `enforced` (writer waivers ignored), or `off` (waived for everyone, including no-profile users and legacy no-requester generation paths). The rules themselves are visible in-app on `/admin/house-rules` — locked CRA tier, full house-rule texts, banned-word tables — instead of living only in prompt source. Writers paste their instructions and get an analysis that pre-ticks the waivers their document legislates and quotes anything conflicting with the locked CRA tier, so preferences apply without checkbox hunting. Precedence order is: locked CRA tier > org mode > writer toggle > house default. Config-absent or malformed config degrades safely to `writer_choice`.

## Acceptance criteria

- [ ] `/admin/house-rules` shows the locked CRA tier, each house rule's full text, and the banned-word tables (read-only).
- [ ] Per-category modes persist in `appSettings` `houseStyle.modes` and apply org-wide, including users with no writer profile and legacy generations with no recorded requester (`off` waives for these paths too).
- [ ] Mode `enforced` beats a writer's waiver toggle; the category is enforced regardless of profile settings.
- [ ] Settings page renders `enforced` toggles locked-unchecked ("Managed by your organization") and `off` toggles locked-checked ("Disabled for everyone").
- [ ] "Analyze my instructions" pre-ticks waivers for categories the pasted document legislates and reports conflicts with the locked CRA tier in a ✓/–/🔒 report; it never un-ticks a manual choice.
- [ ] Missing or malformed `houseStyle.modes` config degrades to `writer_choice` for every category (identical to PSOS-49 behavior).
- [ ] Tests green: `shared/styleOverrides.test.ts` (mode normalization + resolution matrix), `convex/houseStyle.test.ts`, `convex/writerProfiles.test.ts` additions (enforced beats writer waiver; off applies with no profile), `convex/ai/styleAnalysis` prompt/schema unit tests.

## Dependencies and boundaries

- **Dependencies:** PSOS-49 (per-writer house-style overrides — this ticket layers org modes over its writer toggles and reuses its category list, freezing semantics, and consumer plumbing).
- **Storage impact:** one new `appSettings` key (string JSON); no schema table changes, no backfill.
- **Authorization:** `houseStyle.setModes`/`getConfig` admin-only (`requireRole`); `getModesForMe` any authed user; `analyzeMyInstructions` authed.
- **Out of scope:** banned-word term editing in-app (follow-up candidate PSOS-51); manager read access; editing locked CRA text in-app; auto-running analysis on every save; per-project modes.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-08-24 | Modes stored as JSON in one `appSettings` key (`houseStyle.modes`) rather than five scalar keys. | One atomic read/write for the whole config; normalization handles absent/malformed values in one place. | Product owner |
| 2026-08-24 | Mode controls are admin-only — roles are writer/manager/admin, with no separate owner role. | `requireRole` on the existing role model; no new role invented for governance. | Product owner |
| 2026-08-24 | Mode `off` applies even without a `userId` (legacy generation paths with no recorded requester). | "Disabled for everyone" must mean everyone; org-level modes cannot depend on a profile existing. | Product owner |
| 2026-08-24 | The instruction analysis suggests and pre-ticks waivers but never un-ticks a manual choice. | Analysis is advisory LLM output; the writer confirms the toggles and stays the authority over their own settings. | Product owner |
