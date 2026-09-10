# Reconcile 2026-09-09 — spec-pd-generation + ux-Banhall-2026-09-09 against ARCHITECTURE-SPINE.md

Scope: the 2026-09-09 update block only (AD-4/5/9/11/16 pointers, AD-23..AD-30, the Generation UI
convention row, the new capability-map row, the new Deferred rows, Q15–Q17). Spine not modified.

## CAP → AD map (all 17 covered)

| CAP | Governing AD(s) |
| --- | --- |
| CAP-1 | AD-23 |
| CAP-2 | AD-23 |
| CAP-3 | AD-23 |
| CAP-4 | AD-23 |
| CAP-5 | AD-24, AD-25, AD-27 |
| CAP-6 | AD-26 |
| CAP-7 | AD-25 |
| CAP-8 | AD-25, AD-26 |
| CAP-9 | AD-24, AD-25, AD-27 |
| CAP-10 | AD-24 (structural parity itself is existing AD-8; AD-24's Binds line names CAP-10 but its Rule text only supplies the assembled-draft consistency pass as the mechanism — see Gaps) |
| CAP-11 | AD-23 (2026-09-09 pointer), AD-30 |
| CAP-12 | AD-25, AD-28 |
| CAP-13 | AD-28 |
| CAP-14 | AD-28 |
| CAP-15 | AD-28 |
| CAP-16 | AD-29 |
| CAP-17 | AD-30 |

No uncovered CAP.

## Captured

- **Effort ceiling** (SPEC Constraints: "The Dump is the maximum required input") — AD-26: "`docs/product-domain.md` records the four tiers, the 'no silent tier' rule and the effort ceiling (the Dump is the maximum required input) as one dated amendment."
- **Brief never enters the Brain** (SPEC Constraints) — AD-23: "`generationBriefs` and their entries are project-scoped rows (AD-19), excluded from every `brainSources` nomination path and from the Brain retriever."
- **Hedging of unresolved facts** (CAP-9 success) — AD-25: "A fact the Confidence Map marks unresolved or unreliable stated without hedging fails the check."
- **Ungated default / iterative-only gate** (SPEC Constraints) — AD-24 Binds/Prevents/Rule matches verbatim: ungated chain in `single`/`compare`, `iterative` keeps its gate.
- **Call budget / 2x ceiling, overruns recorded not absorbed** (SPEC Constraints, SM-C2) — AD-27 slot vocabulary and "no call is refused on budget (Q12: alert only)" matches exactly.
- **Context cap unchanged, inclusion visible** (SPEC Constraints, CAP-11, CAP-17) — AD-30: `DEFAULT_CONTEXT_BUDGET.maxDocuments` stays 12, only `appSettings` changes it; ≥40-document attachment independent of the budget.
- **Proposals-only path preserved** (SPEC Constraints) — AD-28: "`saveProposal` stays the only `chatProposals` insert; `applyProposal` is untouched," extending AD-4 rather than adding an eighth writer (AD-3's closed list is untouched).
- **Precedence tiers + no silent tier** (CAP-6, CAP-8) — AD-26 restates the four tiers and amends AD-16; `profileState: applied | disabled | missing` backs CAP-8's "no Writer Profile applied" requirement.
- **Q15–Q17** land exactly on their SPEC Open Questions (Sol-equivalence caveat, context-cap trigger, Claim Exclusion retention under Pre-Claim Approval) — no architecturally-weighted SPEC Open Question was left stranded.
- **Non-goals / Deferred parity** — CAD/DWG, per-section multi-select + optional per-writer Brief gate, ChatGPT-baseline automation, 40-doc cap raise, per-document trust-order display all appear verbatim as Deferred rows.
- **UX → AD, the strong cases** — brief-rail/brief-entry/origin-chip/storyline-question ← AD-23 (+AD-25 cross-ref for the question); generation-section-row (Stop-after-section, ungated states) ← AD-24; compliance-line/compliance-section ← AD-25, plus the new Generation UI convention row names the exact placement (section-end line, QA-rail section) EXPERIENCE.md specifies; inclusion-row ← AD-30; save-settings-banner ← AD-26; inventory-checklist and completion-row ← AD-25 (reader) + AD-28 (writer/shape), field-for-field match (`resolved|blocked|conflicting`, missing-fact+source, locked-rule+alternative); comparisons-form ← AD-29, field-for-field match including judge, model-equivalence caveat, `usedInDevelopment` exclusion.

## Gaps

1. **The 16/16 harness is not named as an enforcing check in the spine.** SPEC's Success signal and CAP-13's success criterion single out "the live-model chat-behaviour harness with a 16-item fixture mixing rule and content Deviations reports 16/16 on every run" (= SM-2), and `touchpoints.md` names it explicitly as a `scripts/chat-behavior-eval.mjs` fixture. AD-28's Rule text cites `scripts/chat-behavior-eval.mjs` only for the "make it better" guard fixture — the 16-item coverage fixture is never named. *Location: SPEC.md CAP-13 success / Success signal; touchpoints.md CAP-12–15 row; spine AD-28 (`ARCHITECTURE-SPINE.md:426`).*
2. **Brief re-derivation "diff" has no backend mechanism.** CAP-4 success requires "adding a Transcript re-derives the Brief and lists added and removed Confidence Map entries"; EXPERIENCE.md's brief-rail and the "Inputs changed since the last Brief" state require "N added · N removed" per group with changed rows marked, and DESIGN.md defines `added-marker`/`removed-marker` tokens for it. AD-23's Rule only says a writer edit "inserts a new version and never mutates an old one" — it never specifies how (or where) the added/removed comparison between Brief versions is computed or stored. *Location: SPEC.md CAP-4; EXPERIENCE.md brief-rail and State Patterns "Inputs changed since the last Brief"; DESIGN.md brief-rail; spine AD-23 (`ARCHITECTURE-SPINE.md:392-396`).*
3. **reference-pd-mark has no data shape in any AD.** EXPERIENCE.md's `reference-pd-mark` component and its State row require "at most one document per project is marked; marking a second unmarks the first," surfaced on the New-project page and FilesPanel and read by chat to offer the Suggestion. No AD (nor `touchpoints.md`, which only names a "Reference PD comparison tool" in `chatAgentV2.ts`) names the field/table that persists this mark (e.g., on `projectDocuments` or `projects`). *Location: EXPERIENCE.md reference-pd-mark component + State Patterns "Reference PD marked"; touchpoints.md CAP-12–15 row; absent from spine AD-23/AD-28.*
4. **missing-facts-reply's data source is implied, not stated.** CAP-14 and EXPERIENCE.md's `missing-facts-reply` both specify the reply is "drawn from unresolved Confidence Map entries," but AD-28 (which owns CAP-14) only states the "never a document" guard and its fixture — it doesn't name Confidence Map entries as the query source the way it names `complianceNotes` for the Deviation Inventory. Low severity: the linkage is inferable from AD-23's Confidence Map storage, but it's not made explicit the way the Inventory's source is. *Location: SPEC.md CAP-14; EXPERIENCE.md missing-facts-reply; spine AD-28 (`ARCHITECTURE-SPINE.md:422-426`).*
5. **CAP-10's binding is thin.** The capability-map row and AD-24's own Binds line both cite AD-24 for CAP-10 (glossary/paragraph-structure/skeleton parity between editor and export), but AD-24's Rule text is about per-section action chaining, not glossary-term consistency or export parity — those are actually governed by existing AD-8 (canonical format/export parity, unchanged) and AD-26 (`paragraphDensity` as a Writer Profile category). The assembled-draft consistency pass AD-24 does add is a plausible mechanism for glossary-term consistency across sections but the spine never draws that line explicitly. *Location: spine capability-map row (`ARCHITECTURE-SPINE.md:707`); AD-24 (`ARCHITECTURE-SPINE.md:398-402`); AD-8 (`ARCHITECTURE-SPINE.md:300-304`).*

## Contradictions

None found. No new AD (AD-23–AD-30) contradicts a SPEC Constraint (Brief never gates, ungated default, Proposals-only, cap unchanged, no self-scores in comparison, Convex guidelines) or the AD-4/AD-11/AD-16 pointers; AD-29 explicitly keeps LLM self-scores out of comparison outcomes and AD-28 explicitly leaves `applyProposal`/AD-3's closed writer list untouched. No EXPERIENCE.md behaviour was found that the spine makes impossible — the closest case (inventory-checklist sending only checked rows while AD-28 requires "full coverage of N ≤ 30") resolves cleanly: N in AD-28 is the count actually sent, which is what the UI's checked-row filter produces.

## Invented

1. **`comparisons.voidsComparisonId` (AD-29) has no SPEC or `measurement-protocol.md` support.** It exists solely to back EXPERIENCE.md's own `[ASSUMPTION]`-tagged UX behaviour ("a wrong record is re-entered and the old one marked void `[ASSUMPTION]`"). Not harmful — it's traceable to a named UX assumption rather than invented from nothing — but it is a schema commitment resting on an unconfirmed UX assumption rather than a validated CAP-16 success criterion. *Location: EXPERIENCE.md comparisons-form; spine AD-29 (`ARCHITECTURE-SPINE.md:428-432`).*

No other AD-23..AD-30 rule was found to invent a shape unsupported by `SPEC.md`/`touchpoints.md`/`glossary.md`; the additional field-level detail in AD-23 (child rows with `startOffset`/`endOffset`/`exactExcerpt`), AD-25 (`candidateRunId?`) and AD-28 (`missingFactSource?`) are elaborations consistent with `touchpoints.md`'s own note that its mechanism notes are "guidance for architecture, not prescription," and each maps onto an explicit SPEC success criterion (provenance validation, compare-mode candidates, blocked-item sourcing).
