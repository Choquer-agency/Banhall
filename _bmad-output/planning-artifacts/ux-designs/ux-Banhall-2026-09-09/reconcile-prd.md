# PRD Reconciliation — Banhall PD generation

**Input checked:** `prd-Banhall-2026-09-09/prd.md`
**Spines checked against:** `DESIGN.md` (visual identity) and `EXPERIENCE.md` (information architecture / behavior), both at `ux-Banhall-2026-09-09/`.
**Method:** every UX-relevant claim (anything a user sees, does, is told, or that constrains what they can see/do/be told) in PRD §3.3, §4.1–4.6, Cross-Cutting NFRs/Constraints, §6, §8, §9 is traced to a specific spine location or marked DROPPED. Read-only; no source file was modified.

---

## 1. User Journeys (§3.3)

### UJ-1 — Larry, first draft for a 1300-hour project

| PRD claim | Landed in |
|---|---|
| Pastes Storyline into Brief's Storyline slot; picks Sol; generates | EXPERIENCE.md Key Flows UJ-1 step 1; IA table "Storyline slot" row |
| Brief fills in: Claim Exclusions, Confidence Map, Glossary Terms, each showing the Transcript passage | EXPERIENCE.md UJ-1 step 3; `source-chip` pattern ("opens the passage in a popover") |
| Glances, edits one Glossary Term, leaves rest | EXPERIENCE.md UJ-1 step 3 |
| Draft arrives section by section in Build Order, each with a Compliance Note showing what was checked/repaired | EXPERIENCE.md UJ-1 step 4; `compliance-line` — "Checked 6 rules, repaired 1." |
| Compliance Note on 246 quote ("applied up to the CRA limit of 50 lines; locked") | EXPERIENCE.md UJ-1 climax — near-verbatim match, also in Voice and Tone table |
| "he did not create a single document to get there" | EXPERIENCE.md UJ-1 climax — "he did not write a single document to get here" |
| Edge case: transcript exceeds budget → Brief says "condensed to a digest; full text available"; Confidence Map marks digest-sourced entries | EXPERIENCE.md UJ-1 Failure line + State Patterns "Over budget" row ("digest" on source-chip) — concept landed; exact phrase "full text available" not reproduced (paraphrase only) |

### UJ-2 — Larry corrects sixteen Deviations in one pass

| PRD claim | Landed in |
|---|---|
| Asks for Deviation Inventory; 14 rule Deviations + 2 writer-added content corrections = 16 | EXPERIENCE.md UJ-2 steps 1–2; `inventory-checklist` |
| "bring all sixteen into alignment" | EXPERIENCE.md UJ-2 step 3 — exact quote match ("Bring all 16 into alignment") |
| One Coordinated Revision + Completion Report: 14 resolved / 1 blocked / 1 conflicting | EXPERIENCE.md UJ-2 step 4 — exact match |
| Reviews diff, applies | `completion-row` / existing Replace action |
| Second draft materially closer to Reference PD | EXPERIENCE.md UJ-2 climax — exact phrase |
| "how can I help you converge?" → two missing facts, never a request for a document | EXPERIENCE.md UJ-2 Failure/edge — landed, mirrors FR-14 |

### UJ-3 — Tracy, three transcripts, no Writer Profile

| PRD claim | Landed in |
|---|---|
| Drops three, generates; Brief reconciles one Storyline; Confidence Map flags disagreement | EXPERIENCE.md UJ-3 steps 1–2 |
| House Rules apply in full (no settings) | EXPERIENCE.md UJ-3 step 3; State Patterns "No Writer Profile" row |
| Disagreements visible, not averaged away | EXPERIENCE.md UJ-3 climax — exact phrase |
| Edits in tool, never opens ChatGPT | EXPERIENCE.md UJ-3 climax |

### UJ-4 — Michael runs the Paired Comparison

| PRD claim | Landed in |
|---|---|
| Identical Dump into ChatGPT and Banhall; third party strips to plain text; Larry rates blind; counts by same manual method | EXPERIENCE.md UJ-4 steps 1–2 |
| Results stored with the generations, table of records | EXPERIENCE.md UJ-4 step 3; IA "Admin comparisons" row. **Caveat:** PRD frames storage as "with the generations"; spine surfaces it as a separate `/admin/comparisons` table — not contradictory, but the tie back to individual generation records isn't shown in the UI description |

### UJ-5 — Larry, 150-hour project in an afternoon

| PRD claim | Landed in |
|---|---|
| One short Transcript, no Storyline typed, Brief derives one, draft in Build Order | EXPERIENCE.md UJ-5 steps 1–2 |
| One Coordinated Revision → acceptable PD without ChatGPT | EXPERIENCE.md UJ-5 climax — exact phrase |
| Resolution: "small projects become the tool's default home" | Not a UX-surface claim (business/adoption narrative) — correctly out of scope for a UX spine, not counted as dropped |

---

## 2. Functional Requirements (§4.1–4.6)

### 4.1 Generation Brief

| FR / consequence | Landed in |
|---|---|
| FR-1: writer-supplied or derived Storyline before drafting | EXPERIENCE.md `storyline-slot`, IA table |
| FR-1: "every Storyline claim shows the Confidence Map entries it rests on" | **Partially landed.** `brief-entry`/`source-chip` link each row to a *passage*, not explicitly to the Confidence Map's established/partial/unresolved/unreliable *classification*. No spine element shows a Storyline claim's confidence tier inline outside the `storyline-question` contradiction case. |
| FR-1: generation record stores writer-supplied/derived/derived-then-edited | `origin-chip` states (*writer*/*derived*/*edited*) |
| FR-1: Storyline question surfaced with both sides on contradiction | EXPERIENCE.md `storyline-question` component + State Patterns row |
| FR-1: three-transcript disagreement surfaced, not resolved silently | EXPERIENCE.md UJ-3 |
| FR-2: Claim Exclusions/Confidence Map/Glossary Terms derived, tied to source passage | `brief-rail` groups + `source-chip` |
| FR-2: every Claim Exclusion carries an eligibility reason | **DROPPED (display).** `brief-entry` is described as "entry text + origin-chip + source-chip"; no explicit field for the eligibility reason (business risk / routine engineering / outside period / not technological) shown on the row. |
| FR-2: digest-sourced Confidence Map entries marked as such | `source-chip` "digest" label |
| FR-3: Brief visible, editable, optional; generation completes with no interaction | `brief-rail`, Do's/Don'ts "Never blocks generation, apply, or navigation" |
| FR-3: edited entry used verbatim, recorded writer-edited with edit magnitude | `origin-chip` *edited* + "recorded with its magnitude" |
| FR-3: Brief never asks for a document; only supply/edit/leave | `storyline-slot` optional + Do's/Don'ts |
| FR-4: Brief reused across identical-input regenerations (one Brief id) | Not surfaced in UI description — backend guarantee, not a user-visible claim, so not counted as a UX drop |
| FR-4: changed inputs re-derive Brief and **show what changed** (added/removed Confidence Map entries) | **DROPPED.** No diff/changelog view of the re-derived Brief anywhere in EXPERIENCE.md; only an edit-triggered "Regenerate with this Brief" button, which is a different mechanism (writer-initiated, not input-driven). |

### 4.2 Writer Profile fidelity

| FR / consequence | Landed in |
|---|---|
| FR-5: generation in Build Order, Self-check before each paragraph | `generation-section-row` (Build Order), `compliance-line` |
| FR-5: failed Self-check triggers repair, recorded in Compliance Note | `compliance-line` "Checked 6 rules, repaired 1." |
| FR-5: no Build Order → falls back to 242→244→246 | `generation-section-row` — "Build Order (profile) or 242 → 244 → 246" |
| FR-5: single/compare ungated by default; iterative stays gated; decision 2026-09-09 | EXPERIENCE.md "Rejected — gating on Brief approval... the gated path stays iterative"; `generation-section-row` "No approve step; IterativeStepper untouched" |
| FR-6: precedence Locked > enforced Org Mode > Writer Profile > House Rules, no silent tier | `compliance-line` reasons: "locked · org-enforced · conflict · missing fact" |
| FR-6: instruction exceeding cap applied up to cap and reported | UJ-1 climax quote (246 example) |
| FR-7: Compliance Note per section, every non-applied instruction reported | `compliance-line`, `compliance-section` |
| FR-8: settings-as-document recognised, offered save to profile | `save-settings-banner` — "Your customized settings were found in Writer's notes. Save to your Writer Profile?" |
| FR-8: disabled/missing profile reported, never silently replaced | Voice and Tone + State Patterns — "No Writer Profile applied — House Rules in full." |

### 4.3 Draft quality

| FR / consequence | Landed in |
|---|---|
| FR-9: excluded claim / off-glossary synonym / cap breach repaired or flagged before display | General Self-check + Compliance Note tier vocabulary (not itemized by violation type, but subsumed) |
| FR-9: unresolved/unreliable facts hedged in prose, never stated as established | **Out of UX-spine scope by design.** DESIGN.md: "Report prose stays `{typography.prose}`... untouched by this work." The *prose content* behavior isn't addressed by either spine (reasonably — it's a generation/content concern, not an interface concern). See Qualitative Ideas §5 below. |
| FR-9: Storyline contradiction raised as a question, not silently repaired | `storyline-question` |
| FR-9: check outcome part of the quality scorecard, visible in Compliance Note | `compliance-section` inside QAScorePanel |
| FR-10: export and editor show identical paragraphs/headings | EXPERIENCE.md Responsive & Platform — "the DOCX export is prose only (existing)" |
| FR-10: paragraph density rule | Backend/content rule, no UX surface needed — not counted as a drop |
| FR-11: per-document full/condensed/not-included line, user-facing | `inclusion-row`, Inputs band header "N of M documents in context · cap N" |

### 4.4 Convergence in one pass

| FR / consequence | Landed in |
|---|---|
| FR-12: Deviation Inventory lists paragraph, rule, Deviation; writer adds content corrections to same list | `inventory-checklist` |
| FR-12: "every paragraph of the draft appears exactly once in the inventory" | **See Contradictions §4 below** — spine's `inventory-checklist` appears to list only deviating rows (sourced from Compliance Notes), not one row per paragraph regardless of deviation status. |
| FR-13: one Proposal + Completion Report for N items, none omitted | `completion-row`, Coordinated Revision card |
| FR-13: Proposal still requires human apply | "apply remains human"; ProposedEditCard actions unchanged |
| FR-14: propose improvements or name missing facts; never request a writer-authored document | EXPERIENCE.md UJ-2 edge case |
| FR-15: Reference PD differences named by paragraph, offered as Coordinated Revision | IA "Reference PD compare" row |
| FR-15: comparison names paragraphs, not scores; no numeric self-score as primary output | Inspiration & Anti-patterns — "Rejected — numeric self-scores as the headline" |

### 4.5 Paired Comparison

| FR / consequence | Landed in |
|---|---|
| FR-16: Paired Comparison harness, blind preference, Deviation/Corrections counts by same manual method | EXPERIENCE.md UJ-4 flow |
| FR-16: comparison record fields (project, models, judge, preference, counts, dev flag, date, model-equivalence caveat) | UJ-4 step 3 names project/models/judge/preference/counts/development-flag. **Not explicitly named:** the model-equivalence caveat (Open Question 3) and date — likely subsumed under "a form and a table," but not called out. Minor gap. |

### 4.6 Input capacity

| FR / consequence | Landed in |
|---|---|
| FR-17: attach ≥40 Supporting Documents; included/condensed/not-included visible before reading draft | `inclusion-row`, Inputs band |
| FR-17: configured cap shown, not silent; excluded doc never called "used" | Inputs band header "cap N"; "A document *not included* is never described as used anywhere else on the surface." |
| FR-17 (§6.2): per-document **trust-order display** deferred to v1.1, MVP shows included/condensed/not-included only | **See Contradictions §1 below** — EXPERIENCE.md's `inclusion-row` states rows are shown "in the trust order used," which appears to contradict the explicit MVP deferral. |

---

## 3. Cross-Cutting NFRs and Constraints

| PRD claim | Landed in |
|---|---|
| Provenance: every Brief entry, Compliance Note, Completion Report line stored and linked to source | `source-chip` mechanism throughout Brief, Inventory, Completion rows |
| No fabrication (Locked Rule) | Implicit via Locked Rule tier / "blocked" mechanism for missing facts |
| Human apply (agents propose, humans apply) | Reiterated throughout ("apply remains human") |
| Latency/cost: 2x budget; **overrun reported in the scorecard, not absorbed** | **DROPPED.** No "overrun" indicator anywhere in `compliance-section`/QAScorePanel description in either spine. |
| Privacy: Brief project-scoped, no Brain leakage without approval | Not a UI-surface claim — correctly not addressed by a UX spine |
| Retention of Claim Exclusions (pending OQ9) | Policy question, correctly not addressed by UX spines |
| Determinism: identical inputs reuse the Brief | Backend guarantee (see FR-4 above); not user-visible, not counted as a drop |
| **Writer effort ceiling: the Dump is the maximum required input** | Landed as a pervasive design principle — see Qualitative Ideas §6 |
| Locked Rules not negotiable | `compliance-line` "locked" tier throughout |
| Role permissions unchanged | Not UX, correctly out of scope |

---

## 4. MVP Scope (§6)

| PRD claim | Landed in |
|---|---|
| FR-1–FR-16 in scope | Landed per tables above |
| FR-17 in scope only at "included/condensed/not-included" level; trust-order display **out of scope for MVP** | **Contradiction — see Contradictions §1.** |
| Per-section multi-select deferred (v2) | Correctly absent from both spines |
| Hard doc cap stays at 12 (visibility only) | `inclusion-row` cap language consistent with this |
| CAD/DWG, automated ChatGPT baseline out of scope | Correctly absent |

---

## 5. Open Questions (§8)

| OQ | PRD framing | Spine treatment |
|---|---|---|
| OQ1 (246 cap: locked-cap disagreement or House Rule leak?) | Open, pending Larry's settings doc | Spine bakes in "locked" as the answer (UJ-1 climax, per PRD's own §9 assumption "Locked Rules stay locked including 246 caps") — consistent with the PRD's stated assumption, not an overreach. |
| OQ3 (Sol vs ChatGPT Sol equivalence; record caveat on every comparison) | Open | Comparison-record caveat field not explicitly named in UJ-4 UI description — minor gap, noted in §4.5 table above. |
| **OQ5 (must the Brief be approved before drafting for some writers — optional gate setting, or v2 only?)** | Explicitly left open, two named alternatives | **Spine forecloses it rather than leaving it open.** EXPERIENCE.md Inspiration & Anti-patterns: "Rejected — gating on Brief approval: a required checkpoint before the first section is the interruption the PRD forbids (SM-C4); the gated path stays `iterative`." DESIGN.md Do's/Don'ts: "Open the Brief as a modal or a gate before generation" = Don't. This resolves OQ5 in the "never, beyond existing iterative mode" direction, with no per-writer optional-gate-setting path represented. Worth flagging back to the PRD owner as a decision made inside the UX pass rather than left open — not a contradiction (it's consistent with FR-3/§4.1's own assumption that the Brief never gates), but it does answer a question the PRD explicitly marked unresolved. |
| **OQ8 (where does the Compliance Note live without cluttering the draft?)** | Explicitly open | **Directly and thoroughly answered.** DESIGN.md `compliance-line`: "sits `{spacing.section-end-gap}` below the existing section-end marker... never overlays it." Do's/Don'ts: "Compliance as a line under the section-end marker" vs. "Compliance badges, highlights or margin notes inside the prose" (Don't). This is the single clearest open question the spines resolve. |
| OQ2, OQ4, OQ6, OQ7, OQ9 | Open | Process/product-ownership questions (which mode Larry uses today, who judges, when the cap rises, compliance retention framing) — correctly not addressed by a UX spine; no drop to report. |

---

## 6. Section 9 — Assumptions Index

Cross-checked against spine content; no spine assertion conflicts with a PRD-listed assumption. The two assumptions with UX weight (§4.1 Brief never gates; §4.2 Locked Rules stay locked) are both reflected consistently, as noted above. FR-17's assumption ("the per-document order display is v1.1") is the one assumption the spine appears to override — see Contradictions §1.

---

## Qualitative ideas

1. **Overall tone description in the PRD** ("better than ChatGPT... on the writer's own terms, the CRA's terms, the reader's terms"; calibrated, non-oversold) — **Landed.** EXPERIENCE.md Voice and Tone: "Counts and verbs; name the rule or the fact; the tool proposes, the writer decides." Do/Don't column contrasts factual statements ("Checked 6 rules, repaired 1.") against hype ("AI has verified this section!", "Great job, no issues found!"); closing line "Never 'AI', never an exclamation mark, never 'successfully'." This directly operationalizes the PRD's calibrated, non-oversold register.

2. **"never hands the writer homework"** — **Landed**, in multiple places. Vision language echoed almost verbatim by FR-14 ("never asks the writer to produce a Storyline, Claim Exclusions, a Confidence Map, Glossary Terms or any other document"), landed at EXPERIENCE.md UJ-2 edge case ("the reply lists the two missing facts as client questions, never a request for a document") and reinforced structurally by `storyline-slot` being optional, `save-settings-banner` "Never a modal; never blocks," and the Do's/Don'ts row "Never blocks generation, apply, or navigation."

3. **"he never has to ask it to take its time"** (diligence is default, not requested) — **Landed implicitly, not stated as an explicit design principle.** The mechanism matches the idea: `compliance-line` is unconditional and always-on for every section ("Checked 6 rules, repaired 1." shown by default, not on request), and Self-check/repair happens before any section is shown. But neither spine names this as a tonal or experiential principle the way item 1 is named in Voice and Tone — there's no "show diligence without being asked" line. The behavior is present; the articulated idea behind it is not written down anywhere in EXPERIENCE.md.

4. **Effort being visible (the tool shows its work, not just results)** — **Landed, strongly.** This is one of the best-preserved ideas in the reconciliation. `compliance-line`: "Checked 6 rules, repaired 1." is explicitly a "show your work" pattern in Voice and Tone. `generation-section-row` states (queued · drafting · checking · shown) narrate the process, not just the outcome. State Patterns "Generating" row walks through Inputs → Storyline → other groups → progress rows moving through each state. Inspiration & Anti-patterns explicitly credits this lineage: "Lifted from the existing QA rail: structured findings beside the report, expandable rows, no prose decoration."

5. **"one coherent Storyline never means hiding a weakness"** — **Landed partially.** The *structural* half of this idea (a contradiction between the Storyline and stronger section evidence is raised as a visible question, not silently repaired away) is landed cleanly: `storyline-question` component, plus the explicit design rationale "Rejected — Copilot's Keep/Discard/Regenerate as the compliance model: it hides *why*; a Compliance line always names the rule and the tier." The *prose* half of the same FR-9 sentence — that an unresolved/unreliable fact must be stated with CRA-appropriate hedging in the draft prose itself, never as established — falls outside both spines' scope by design, since DESIGN.md states report prose "is never restyled by a Compliance line" and stays untouched. This is a reasonable UX/content boundary, but it means the "don't hide a weakness" idea only half-survives into the UX spine; the prose-level half is neither landed nor contradicted, just out of frame.

6. **The Dump as an effort ceiling** (bounds what's expected, not just a data-entry step) — **Landed as a pervasive design constraint**, even though the word "ceiling" itself doesn't appear. Evidence: Cross-Cutting NFR "Writer effort ceiling: the Dump is the maximum required input" is enforced by DESIGN.md Do's/Don'ts ("Open the Brief as a modal or a gate before generation" = Don't) and EXPERIENCE.md's explicit rejection of gating ("a required checkpoint before the first section is the interruption the PRD forbids (SM-C4)"), the optionality of `storyline-slot`, and `save-settings-banner` never blocking. The idea shows up as a governing constraint on every "Do/Don't" and "Rejected" list rather than as a single named line — it landed as an operating principle, distributed rather than quoted.

---

## Contradictions

1. **Trust-order display (FR-17 / §6.2) vs. `inclusion-row` (EXPERIENCE.md).** The PRD explicitly defers "FR-17's per-document trust-order display (the order in which documents filled the context)" to v1.1, stating MVP "shows included / condensed / not included only" (§6.2, also §9 Assumptions Index). EXPERIENCE.md's `inclusion-row` pattern reads: "One row per attached document, status included · condensed · not included, **in the trust order used**." Displaying rows in trust order surfaces the very ordering information the PRD says is deferred. This should be resolved before build — either the spine's ordering clause is dropped for MVP, or the PRD's MVP/v1.1 split needs revisiting.

2. **Deviation Inventory exhaustiveness (FR-12) vs. `inventory-checklist` (EXPERIENCE.md/DESIGN.md).** FR-12's testable consequence is explicit: "Every paragraph of the draft appears exactly once in the inventory." Both spines describe the Inventory's Rule rows as sourced "from stored Compliance Notes" (i.e., from Deviations), and the worked UJ-2 example shows 14 rows for 14 rule-level Deviations, not one row per paragraph of the draft (which presumably contains more than 14 paragraphs, many with no Deviation). Unless a paragraph with zero Deviations is meant to appear as a row reading "no deviation" (unstated in either spine), the spine's inventory looks like a deviations-only list, not the paragraph-exhaustive list FR-12 specifies. Flagging as a likely contradiction rather than a simple drop because the spine positively describes a different sourcing mechanism, not merely an omission.

---

## Summary

- **Landed (fully or with only a minor caveat noted):** ~46 claims across journeys, FRs, NFRs, MVP scope, and qualitative ideas.
- **Dropped:** 5 — FR-2 eligibility-reason display, FR-4 "show what changed" on re-derivation, FR-1's Confidence-Map-linkage-per-claim (partial drop), the SM-C2 latency/cost "overrun" scorecard indicator, and the FR-16 comparison-record caveat/date fields (minor).
- **Contradicted:** 2 — the FR-17 trust-order display appearing in `inclusion-row` despite explicit MVP deferral, and the Deviation Inventory's apparent deviations-only sourcing against FR-12's "every paragraph, exactly once" requirement.
- **Most important dropped/contradicted item:** the **FR-17 trust-order contradiction** (Contradictions §1) is the one most likely to cause a build mismatch — it's a specific, testable MVP/v1.1 boundary in the PRD that the spine's own component description crosses without comment, and it's a small phrase change away from either being fixed or silently shipped wrong.
