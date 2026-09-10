# Currency review — 2026-09-09 update to ARCHITECTURE-SPINE.md

Reviewer lens: verify every claim in the 2026-09-09 update (AD-23..AD-30, the
dated pointer bullets under AD-4/5/9/11/16, the new conventions row, the
capability-map row, the Deferred rows, Q15-Q17) is reality-checked against
the repo at HEAD `c55014f` (brownfield — no live web claims in this delta),
not asserted from training data. Every file:line/symbol citation below was
opened and diffed against the claim.

## Verdict

**Mostly current, with three confirmed drift/citation errors and one
material omission.** All new tables/files the update marks `[TARGET]`
correctly do not exist yet (`generationBriefs`, `generationBriefEntries`,
`complianceNotes`, `chatProposalItems`, `comparisons`, `ai/brief.ts`,
`lib/glossaryMatcher.ts`) — that's consistent, not drift. The load-bearing
symbol citations (`createProvenance`, `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE`,
the 600s budget math, `DEFAULT_CONTEXT_BUDGET.maxDocuments`, `getEffectiveWriterStyle`'s
existence and behavior, `makeProposeBulkEdits`'s line span, `claimSectionRun`/
`approveSectionDraft`, the model id, the Convex child-rows/index-naming
guideline) check out. The real problems are: a stale line-range on
`writerProfiles.ts`, a factual overstatement in AD-28 about what
`chatAgentV2.ts`'s findings union and cap *currently* are, a cited eval
fixture that does not exist in `scripts/chat-behavior-eval.mjs`, and a Stack
table that is 6 days stale on two rows (one is off by a full minor version)
and omits `zod` even though AD-28 leans on `zod`'s `discriminatedUnion` +
`superRefine` by name.

## Claim table

| Claim | Cited anchor | Verified? | Correct anchor / note |
| --- | --- | --- | --- |
| `createProvenance` validates each entry's citation like AD-23 describes | `convex/reports.ts:77-138` | Yes (near-exact) | Function is `convex/reports.ts:77-139`; body/logic matches exactly (hash + slice-equality check against frozen `generationSources`). Off by one closing line, immaterial. |
| A `brief` stage is declared in every `topology.modes.*` array between `analyzer` and the first section, as `calls.brief` with `two-attempt-repair` | `convex/ai/promptProgram.ts` | Not yet true (consistent with `[TARGET]`) | Today `topology.modes.*` starts every mode with `"retrieval-brief-with-fallback-query"` (a Brain retrieval-query fallback, unrelated to the Generation Brief) and `topology.calls` (line 268) has no `brief` key — the calls that exist (`retrievalBrief`, `condense`, `analyzer`, `section242/244/246`, `compression`, `qa`, `chronology`) do use `structuredPolicy: "two-attempt-repair"` as a real, established pattern, so AD-23's naming convention is grounded even though the key itself doesn't exist yet. No drift — this is exactly what `[TARGET]` should look like — but worth noting `"retrieval-brief"` is a false-positive grep target for anyone skimming for "brief". |
| `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5` "cannot hold twelve slots" | `convex/ai/providers.ts` | Yes | `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5` at line 71, exact. |
| `(1+1) x 240 + 60 < 600` | `convex/ai/providers.ts` (AD-9) | Yes | `ANTHROPIC_TIMEOUT_MS = 240_000` (56), `CONVEX_ACTION_LIMIT_MS = 600_000` (33), and the file's own comment at line 45 states the identical arithmetic: "`(1 + 1) * 240 s + 60 s = 540 s < 600 s`". |
| `getEffectiveWriterStyle` returns per-category outcome/tier and `profileState` | `convex/writerProfiles.ts:200-236` | **Drift** | Function is at lines **215-237**, not 200-236 (200-214 is the unrelated tail of `saveProfileForUser`). Also: the function's *current* return type is `{ customInstructions, styleOverrides }` only — no `{category, mode, effective, tier}` array and no `profileState` field yet; those are AD-26 `[TARGET]` additions to this function, which the spine does flag as target, so that part is fine — only the line range is wrong. Correct anchor: `convex/writerProfiles.ts:215-237`. |
| `makeProposeBulkEdits` findings union `resolved \| blocked \| conflicting`, "existing coverage `superRefine` (unique ids, full coverage of N ≤ 30)" | `convex/ai/chatAgentV2.ts:114-155` | **Partial drift** | Line span is exactly right (114-155, confirmed by the next `const highlightPassages` at 157). But today's discriminated union literals are `"proposed" \| "gap" \| "conflict"` (lines 121-124), not `resolved/blocked/conflicting` — that rename matches the UX spec's target pill vocabulary (`ux-Banhall-2026-09-09/DESIGN.md:231`: `status-pill-resolved/blocked/conflicting/applied`), so it's a legitimate forward-looking target, not invented. The numeric cap, however, is stated as "existing" (present tense, no `[TARGET]` hedge) and is simply wrong: `edits` is `.min(1).max(40)` (line 118), findings is `.min(1).max(80)` (line 121) — not "N ≤ 30" anywhere in the file or in `shared/`. |
| The "make it better" guard has "a live fixture in `scripts/chat-behavior-eval.mjs` that fails on any request for a writer-authored artifact" | `scripts/chat-behavior-eval.mjs` (AD-28) | **Not found** | File exists (modified today) and is a real, working eval harness with 7 live fixtures (`sixteen-profile-deviations`, `private-instructions-extraction`, `malicious-document`, `ordinary-product-question`, `brain-opted-in`, `profile-injection`, `followup-extraction`) — none of them tests a "make it better" / writer-authored-artifact refusal. Unlike sibling `[TARGET]` ADs (AD-11, AD-12, AD-13, AD-20), AD-28 gives this sentence no "Current state:" hedge, so as written it reads as a present-tense fact. It is not one today. |
| `getEffectiveWriterStyle` shared by generation, research, and proposal-apply paths | `convex/writerProfiles.ts` | Yes | Matches the function's own JSDoc at lines 209-213 verbatim in spirit. |
| `DEFAULT_CONTEXT_BUDGET.maxDocuments` stays 12 | `convex/ai/trustedContext.ts` (AD-30) | Yes | Line 185: `maxDocuments: 12`, exact. `TrustedContextSource` interface confirmed at line 188. |
| `iterative`'s `claimSectionRun` / `approveSectionDraft` chain (AD-24 relies on it) | `convex/generations.ts` | Yes | `claimSectionRun` at 1428, `approveSectionDraft` at 2033; supporting chain (`failSectionRun` 1498, `regenerateSectionDraft` 2280, `cancelIterativeGeneration` 2328) all present. |
| Model id `openai/gpt-5.6-sol` exists | `shared/generationModels.ts` | Yes | Line 51: `id: "openai/gpt-5.6-sol"`, exact. `MODEL = "claude-sonnet-5"` also confirmed (line 1). |
| `writerReviews` is "pinned to a revision" the way the new `comparisons` table (AD-29) should be | `writerReviews` schema | Yes | `convex/schema.ts:1584` — `writerReviews` has both `revisionNumber: v.optional(v.number())` and `contentHash: v.optional(v.string())`, matching the analogy exactly. |
| `generationSources` / `generationArtifacts` both exist as schema tables | `convex/schema.ts` | Yes | `generationArtifacts` at line 1454, `generationSources` at line 1461. |
| Convex guideline: child rows not arrays; index names include every field | `convex/_generated/ai/guidelines.md` (AD-23's "Convex guideline" aside) | Yes | Line 159: "Do not store unbounded lists as an array field... create a separate table for the child items with a foreign key back to the parent." Line 157: index name must be `by_field1_and_field2` for a `["field1","field2"]` index — matches the Consistency Conventions row `by_<field>[_and_<field>]` exactly. |
| `generationBriefs`/`generationBriefEntries`/`complianceNotes`/`chatProposalItems`/`comparisons` don't exist yet | `convex/schema.ts` | Yes (absence confirmed) | None of these five table names appear in `schema.ts` — correct for `[TARGET]`. |
| New files `ai/brief.ts`, `lib/glossaryMatcher.ts`, `comparisons.ts` are new (capability-map row) | repo tree | Yes (absence confirmed) | None of the three exist yet; `lib/passageEdits.ts` (also cited in that row and AD-28) does exist. |
| PRD §6.2 defers per-document trust-order display to v1.1, MVP shows included/condensed/not-included only | `_bmad-output/.../prd-Banhall-2026-09-09/prd.md` (Deferred row) | Yes | PRD line 283-284: "### 6.2 Out of Scope for MVP ... FR-17's per-document trust-order display ... v1.1; MVP shows included / condensed / not included only." Exact match. |
| A project accepts at least 40 documents (AD-30 / Deferred row) | PRD | Yes | PRD line 249: "A project can attach at least 40 Supporting Documents..." Exact match; no code-side cap of 40 exists yet (none found), consistent with this being PRD-level target, not shipped. |
| Deferred row "PRD Open Question 5" = per-writer Brief gate | PRD §8 | Yes | PRD Open Question 5 (line ~309): "Must the Brief be approved before drafting for some writers... an optional gate setting, or v2 only?" — matches. |
| Q16 = document-cap trigger question | PRD §8 | Yes | PRD Open Question 6: "Document cap: ... When does the cap rise toward 40, and what triggers it...?" — matches Q16's framing (spine doesn't number it "6" but content is identical). |
| Q17 owner Michael, retention of Claim Exclusions | PRD §8 | Yes | PRD Open Question 9: "Retention and framing of stored Claim Exclusions... Owner: Michael..." — matches verbatim, including the owner. |
| Generation UI conventions row: status pills by tier (`applied`, `resolved`, `blocked`, `conflicting`), no modal, no new colour tokens, Compliance line under section-end marker | `ux-Banhall-2026-09-09/DESIGN.md` | Yes | Lines 195, 227, 231, 249-250 of DESIGN.md confirm the pill names, the section-end-line placement, and "A fourth or fifth status colour for Compliance outcomes" listed under what NOT to do (no new tokens). |
| `measurement-protocol.md` exists (AD-29 binds) | repo tree | Yes | `_bmad-output/specs/spec-pd-generation/measurement-protocol.md` exists. |
| zod `discriminatedUnion` + `superRefine` used as AD-28 implies | `convex/ai/chatAgentV2.ts` | Yes | Lines 121 (`z.discriminatedUnion("status", [...])`) and 126 (`.superRefine(...)`) confirmed. |
| Stack table pins match installed versions | `package.json` / `node_modules` | **Partial drift** | See Stack findings below. |

## Stack table currency (checked because AD-28 names zod by pattern and the table is dated `2026-09-03`, six days before this update)

Installed (`node_modules`, checked at HEAD `c55014f`) vs. the table:

| Package | Table says | Installed | Status |
| --- | --- | --- | --- |
| svelte | 5.56.6 | 5.56.6 | match |
| `@sveltejs/kit` | 2.70.1 | **2.70.3** | drift — table stale |
| convex | 1.42.3 | 1.42.3 | match |
| ai | 6.0.230 | 6.0.230 | match |
| `@ai-sdk/anthropic` | 3.0.x | 3.0.98 | matches pattern |
| `@anthropic-ai/sdk` | **0.82.x** | **0.91.1** | drift — table is a full minor version behind |
| vitest | 4.1.x | 4.1.10 | matches pattern |
| zod | *(not in table)* | 4.4.3 | **omission** — zod is load-bearing for AD-28's cited `discriminatedUnion`/`superRefine` pattern but has no Stack row at all |

None of this is introduced by the 2026-09-09 update (the table's own header still says "Verified from `node_modules` 2026-09-03" and was not re-stamped), but since the update leans on zod-specific behavior by name, the missing zod row and the two stale pins are worth flagging as currency debt on the table the update builds on.

## Findings by severity

**High**
- None. No AD-23..30 claim invents a symbol, table, or transition that contradicts the domain contract or an approved amendment.

**Medium**
- AD-28's line "existing coverage `superRefine` (unique ids, full coverage of N ≤ 30)" misstates the current cap — code caps `edits` at 40 and `findings` at 80, not 30 — while using "existing" (present tense, no `[TARGET]` hedge) to describe it. Fix: cite the real cap or explicitly mark it `[TARGET: lower to 30]` if a cap reduction is intended.
- AD-28's claim that `scripts/chat-behavior-eval.mjs` already has "a live fixture ... that fails on any request for a writer-authored artifact" is not true of the file at HEAD; none of its 7 cases test that guard. Needs either a `[TARGET]`/"Current state:" hedge matching the convention used by AD-11/12/13/20, or the fixture needs to be added in the same change.
- `writerProfiles.ts:200-236` is off by 15 lines at the start; the actual function spans 215-237.

**Low**
- Stack table: `@sveltejs/kit` (2.70.1 vs 2.70.3) and `@anthropic-ai/sdk` (0.82.x vs 0.91.1) are stale; `zod` has no row despite being named by pattern in AD-28. Not introduced by this update but exposed by it.
- AD-23's "between `analyzer` and the first section" phrasing is easy to grep-confuse with the existing `"retrieval-brief-with-fallback-query"` topology step, which is a different concept (Brain retrieval fallback, not the Generation Brief). No actual error, just a naming collision worth a disambiguating note if AD-23 is elaborated further.

## Not flagged (checked and clean)

`convex/reports.ts:77-138` createProvenance; `convex/ai/providers.ts` `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE`/600s math; `convex/ai/trustedContext.ts` `TrustedContextSource`/`maxDocuments=12`; `convex/ai/instrument.ts` + `aiUsage` (slot label correctly absent, matching AD-27's `[TARGET]` status); `generationSources`/`generationArtifacts` in schema; `writerReviews` shape; `src/lib/reportSections.ts` (`parseCanonicalReport`, `GAP_MARKER_RE`); `convex/_generated/ai/guidelines.md` unbounded-array and index-naming rules; model id `openai/gpt-5.6-sol`; the `iterative` mode's `claimSectionRun`/`approveSectionDraft` chain; PRD §6.2, PRD Open Questions 5/6/9; UX `DESIGN.md` status-pill and no-modal/no-new-token claims; absence of `generationBriefs`, `generationBriefEntries`, `complianceNotes`, `chatProposalItems`, `comparisons`, `ai/brief.ts`, `lib/glossaryMatcher.ts` (all correctly `[TARGET]`/new).
