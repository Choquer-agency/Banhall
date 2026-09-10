# Reconciliation: spec-pd-generation vs. DESIGN.md / EXPERIENCE.md

Input reconciled: `_bmad-output/specs/spec-pd-generation/` (SPEC.md, glossary.md, user-journeys.md, touchpoints.md)
Spines checked: `DESIGN.md`, `EXPERIENCE.md` (ux-Banhall-2026-09-09)

## 1. Glossary fidelity

Every capitalized term in `glossary.md` was traced against its usage in both spines.

### Mismatches

| Glossary wording | Spine wording | Where | Verdict |
|---|---|---|---|
| **Writer's Notes** (glossary.md:11, capital N) | **Writer's notes** (lowercase n) | DESIGN.md:184; EXPERIENCE.md:23, 49, 70, 71 (×2), 133 — 6 of 6 usages in the spines | Mismatch, repeated everywhere the term is used. Neither spine uses the correctly-cased form once. |
| **Locked Rule** (glossary.md:23, inside the Compliance Note reason-list `(Locked Rule, org-enforced, conflict, missing fact)`) | **locked** (lowercase, dropped "Rule") | EXPERIENCE.md:67, compliance-line row: "the reason naming the tier: locked · org-enforced · conflict · missing fact" | Mismatch. The other three reason labels (`org-enforced`, `conflict`, `missing fact`) are copied verbatim; only the first one is abbreviated/decapitalized. |

### Confirmed correct (coverage sample)

Used with exact glossary casing in both spines, no drift found: **Storyline**, **Claim Exclusions**, **Confidence Map**, **Glossary Terms**, **Deviation** / **Deviation Inventory**, **Coordinated Revision**, **Completion Report**, **Proposal**, **Reference PD**, **Sol**, **Paired Comparison**, **Writer Profile**, **House Rules**, **Self-check**, **Build Order**, **PD**, **Section 242/244/246** (and shorthand "242 → 244 → 246" matching SPEC's own shorthand). `Locked Rules` (plural, as the tier name rather than the reason-label) is correct everywhere it appears (DESIGN.md:170, 205; EXPERIENCE.md:82).

Terms defined in the glossary but not used by name in either spine (not mismatches, just absent — noted for completeness): **The Five Questions**, **Dump**, **Supporting Documents** (used only in singular, "Supporting Document," inside one sentence — acceptable number-agreement, not a wording drift), **Org Mode**, **Corrections-to-acceptable**.

Non-glossary component names that render these concepts (`compliance-line`, `inventory-checklist`, `origin-chip`, etc.) are new UI-element names, not redefinitions of the glossary terms themselves — not counted as violations.

## 2. UJ name fidelity

All five named journeys in `user-journeys.md` are reproduced verbatim as EXPERIENCE.md's Key Flows section headers (EXPERIENCE.md:132, 140, 148, 155, 161):

| user-journeys.md | EXPERIENCE.md Key Flows | Match |
|---|---|---|
| UJ-1 — Larry, first draft for a 1300-hour project | UJ-1 — Larry, first draft for a 1300-hour project | Exact |
| UJ-2 — Larry, sixteen Deviations in one pass | UJ-2 — Larry, sixteen Deviations in one pass | Exact |
| UJ-3 — Tracy, three Transcripts, no Writer Profile | UJ-3 — Tracy, three Transcripts, no Writer Profile | Exact |
| UJ-4 — Michael runs the Paired Comparison | UJ-4 — Michael runs the Paired Comparison | Exact |
| UJ-5 — Larry, a 150-hour project in an afternoon | UJ-5 — Larry, a 150-hour project in an afternoon | Exact |

No renamed, paraphrased, or invented journey names. Protagonists (Larry, Larry, Tracy, Michael, Larry) match in every case.

## 3. Capability surface/state coverage

| CAP | Surface found? | States found? | Gap? |
|---|---|---|---|
| **CAP-3** — Brief visible, editable, never required | Yes — IA "Brief rail view" (EXPERIENCE.md:24); Component Patterns `brief-rail`/`brief-entry` (EXPERIENCE.md:61-62) | Yes — State Patterns "Generating" (EXPERIENCE.md:80, rail defaults to Brief) and "Brief with nothing derived" (EXPERIENCE.md:81); "never required" behaviour also stated directly in the `brief-rail` row ("Never blocks generation, apply, or navigation") | No |
| **CAP-7** — Compliance Note per section, applied/not-applied with reason | Yes — IA "Compliance line" / "Compliance section" (EXPERIENCE.md:27-28); Component Patterns `compliance-line`/`compliance-section` (EXPERIENCE.md:67-68) | Yes — State Patterns "No Writer Profile" row covers Compliance-line behaviour when no profile is active (EXPERIENCE.md:82) | No |
| **CAP-11** — over-budget per-document condensed/cut notice, user-facing | Yes — Component Patterns `inclusion-row` in the Brief Inputs band (EXPERIENCE.md:69) | Yes — State Patterns "Over budget" row (EXPERIENCE.md:84) | No |
| **CAP-12** — Deviation Inventory (every paragraph, rule, + writer-added content Deviations) | Yes — IA "Deviation Inventory" (EXPERIENCE.md:29); Component Patterns `inventory-checklist` (EXPERIENCE.md:72) | Yes — State Patterns "Zero Deviations" (EXPERIENCE.md:87) | No |
| **CAP-13** — one Proposal + Completion Report (resolved/blocked/conflicting) for N items | Yes — IA "Coordinated Revision" (EXPERIENCE.md:30); Component Patterns `completion-row`, `status-pill` (EXPERIENCE.md:73-74) | Yes — State Patterns "Blocked-only Completion Report" (EXPERIENCE.md:88) and "Stale proposal" (EXPERIENCE.md:89) | No |
| **CAP-14** — assistant proposes changes or names missing facts as client questions, never asks for a writer-authored document | **No dedicated surface.** Only appears as narrative in UJ-2's edge case ("he asks 'how can I help you converge?'", EXPERIENCE.md:146). No IA row, no Component Patterns row names this behaviour or gives it a distinct chat-artifact identity. | **No dedicated state.** Nothing in State Patterns addresses the "converge" reply pattern; it is not the same thing as "Blocked-only Completion Report" (CAP-13), which is a Completion Report state, not a free-standing improvement-question reply. | **Gap** — CAP-14 has behavioural coverage only inside a UJ narrative aside, with no named surface or state of its own. |
| **CAP-15** — Reference PD differences reported, offered as Coordinated Revision | Partial — IA row "Reference PD compare" exists (EXPERIENCE.md:31, "Chat Suggestion when a Reference PD is marked"), but there is no Component Patterns row for it; the row text says it reuses Inventory/Coordinated-Revision components rather than naming a distinct artifact. | No dedicated state — relies entirely on inherited Inventory/Completion-Report states; no State Patterns row mentions "Reference PD" at all. | **Partial gap** — surface named only at IA level, no Component Patterns or State Patterns entry of its own. |
| **CAP-16** — Paired Comparison recording (Michael/Johnny) | Yes — IA row "Admin comparisons" (EXPERIENCE.md:32, `/admin/comparisons`); UJ-4 (EXPERIENCE.md:155-159) narrates the form/table | **No.** No State Patterns row covers this surface (no empty-table, validation, or submitted state defined anywhere). | **Gap** — surface exists, states do not. |
| **CAP-17** — 40+ Supporting Documents, included/condensed/not-included shown with cap | Yes — same `inclusion-row` as CAP-11 (EXPERIENCE.md:69) | Yes — same "Over budget" state as CAP-11 (EXPERIENCE.md:84) | No |

**Summary of gaps:** CAP-14 (no surface, no state — narrative-only), CAP-16 (surface yes, states missing), CAP-15 (surface thin/inherited, states missing).

## 4. Constraint non-contradiction

| Constraint (spec wording, source) | Spine evidence | Verdict |
|---|---|---|
| "Ordered generation is ungated by default in `single` and `compare`; the gated path is the existing `iterative` mode only" (SPEC.md:102) | EXPERIENCE.md:26 IA row: "Generation progress … Sections arriving in Build Order, ungated"; EXPERIENCE.md:99 Interaction Primitives "Banned: … any gate before the first section is shown"; EXPERIENCE.md:126 "Rejected — gating on Brief approval … the gated path stays `iterative`"; DESIGN.md:216 Do/Don't: "Don't … Open the Brief as a modal or a gate before generation" | **Respected** |
| "The Brief is shown but never gates generation" (SPEC.md:125, Assumptions) | EXPERIENCE.md:61 `brief-rail` row: "Never blocks generation, apply, or navigation"; EXPERIENCE.md:34 "Modal depth: none added. The Brief never opens as a dialog." | **Respected** |
| "Every prose change is a Proposal a human applies (`chatProposals` + `applyProposal`); no tool mutates report prose directly" (SPEC.md:101) | EXPERIENCE.md:73 completion-row: "the card's existing actions … are unchanged; apply remains human"; EXPERIENCE.md:99 "Banned: … auto-apply of any Proposal"; EXPERIENCE.md:30 IA: "One Proposal with a Completion Report per item; existing apply flow" | **Respected** (spines never describe a direct-mutation path; apply is always the existing human-applied flow) |
| "The context budget (12 documents, admin-configurable) does not change in MVP" (SPEC.md:104) | EXPERIENCE.md:48 example copy "12 of 14 documents in context · cap 12"; EXPERIENCE.md:134 UJ-1 "3 of 3 documents in context · cap 12"; DESIGN.md:209 inclusion-row: "N of M documents in context · cap N" (a variable, not a new hardcoded number) | **Respected** — cap is surfaced, never altered |
| No colour introduced beyond existing design-system tokens | DESIGN.md:10-33 frontmatter: "No new colours" — every hex value cross-checked against `src/routes/layout.css` (canvas #F9FCFB, navy #0A3A38, primary #0DACA5, primary-light #45CFC9, primary-dark #0A8A84, primary-selected #087A75, gap-bg #FEF3C7, red-700 #B91C1C — all found verbatim in layout.css); DESIGN.md:219 Do/Don't: "Don't … Invent an amber, a warning yellow, or a new status hue" | **Respected** — verified against the actual token file, not just the spine's self-description |

No contradictions found for any of the five constraints.

## 5. Capability overreach

Scanned both spines for claims not grounded in SPEC.md capabilities, touchpoints.md, or user-journeys.md.

- **"Generate the rest" secondary action** (EXPERIENCE.md:86, State Patterns "Stopped after a section") — CAP-5 grants only "the writer may stop at any point"; nothing in SPEC, touchpoints, or the UJs describes resuming a stopped generation. The spine does mark this `[ASSUMPTION]`, but it is a genuine invention beyond what CAP-5 defines, not merely an implementation detail of a granted capability.
- **Compliance Note surfaced in two homes** (`compliance-line` at each section end, EXPERIENCE.md:67, *and* `compliance-section` inside QAScorePanel, EXPERIENCE.md:68) — CAP-7's success criterion only requires the note be "visible in the report editor." SPEC.md's own Open Questions list ("Where does the Compliance Note live in the editor?", SPEC.md:142) shows this placement is explicitly undecided upstream; the spine resolves it with two concrete homes rather than one. Not a contradiction of anything, but it settles an open question with more surface than the spec currently grants.
- **"Copy questions for the client" ghost action** (EXPERIENCE.md:88) and **"Brief · N" toggle badge** (EXPERIENCE.md:85) and **shared character limit with Writer's Notes** (EXPERIENCE.md:71) — all three are self-flagged `[ASSUMPTION]` by the spine itself, extending CAP-14/CAP-3/CAP-1 into concrete UI mechanics the spec does not specify. Good practice (visibly flagged, not asserted as fact), listed here only because the check asked for anything claimed beyond the spec's grant, flagged-as-assumption or not.

No unflagged, confidently-asserted capability was found that contradicts or exceeds the spec — the spine's discipline about `[ASSUMPTION]` tags means most overreach is self-declared rather than silent. The two items without an `[ASSUMPTION]` tag ("Generate the rest" is tagged; the dual Compliance Note home is not) are the ones worth a spec author's eye.

## Closing summary

Most important items, ranked:

1. **CAP-14 has no dedicated surface or state** — the "how can I help you converge?" behaviour lives only inside a UJ-2 narrative aside; there is no IA row, Component Patterns row, or State Patterns row for it. This is the clearest coverage gap of the nine capabilities checked.
2. **"Writer's Notes" is mis-cased everywhere it's used** (6/6 occurrences across both spines use lowercase "notes"), the most pervasive glossary-fidelity issue found.
3. **CAP-16 (admin comparisons) has a surface but no states** — no empty/validation/submitted treatment is defined for `/admin/comparisons`.
4. **CAP-15 (Reference PD compare) is thin** — named only at the IA level, with no Component Patterns or State Patterns entry of its own; it fully inherits Inventory/Completion-Report behaviour without saying so explicitly.
5. **Compliance Note gets two UI homes** (section-end line + QA-rail band) against a spec that both under-specifies the location (Open Question) and only requires one ("visible in the report editor") — not a contradiction, but worth a spec-author sign-off.

All five checked constraints (Brief never gates, ungated-by-default, Proposal-only mutation, unchanged document cap, no new colour) are respected, and colour tokens were verified against the live `src/routes/layout.css`, not just the spine's self-report. All five UJ names are reproduced verbatim.
