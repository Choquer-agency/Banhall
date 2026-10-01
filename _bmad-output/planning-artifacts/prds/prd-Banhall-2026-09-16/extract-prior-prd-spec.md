# Extract: prior PRD (2026-09-09), spec-pd-generation, HANDOFF-2026-09-11

Subagent extraction, 2026-09-16. Sources: `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-09/{prd.md,addendum.md,reconcile-transcript.md,.memlog.md}`, `_bmad-output/specs/spec-pd-generation/{SPEC.md,glossary.md,touchpoints.md,stories/}`, `_bmad-output/implementation-artifacts/HANDOFF-2026-09-11.md`.

## 1. Glossary terms to reuse verbatim

Canonical in prd-2026-09-09 §2 (lines 30–59) and `spec-pd-generation/glossary.md` ("introducing a synonym is a contract violation").

- **PD** — the SR&ED technical narrative, Section 242/244/246, answering The Five Questions.
- **The Five Questions** — CRA eligibility test: uncertainty, hypotheses, systematic investigation, advancement, records kept.
- **Section 242 / 244 / 246** — the three CRA parts; existence, order, line/word limits are Locked Rules.
- **Transcript** — an interview transcript; a project holds one or more, ordered.
- **Dump** — Transcripts + title + context + attachments + Writer Profile: "the maximum the tool may require."
- **Writer Profile** — saved settings: paragraph rules, Build Order, Self-checks, terminology preferences.
- **Writer's Notes** — free-text per-project direction at generation time; highest-trust input after the Writer Profile.
- **Supporting Documents** — attachments other than Transcripts.
- **House Rules / Org Mode** — Banhall default style rules; each category `writer_choice | enforced | off`.
- **Locked Rules** — never overridable: 242/244/246 skeleton, line/word caps, no fabrication.
- **Generation Brief (Brief)** — pre-draft structure: Storyline, Claim Exclusions, Confidence Map, Glossary Terms. Shown; editable; never required.
- **Storyline** — controlling narrative every section follows; writer-supplied or derived.
- **Claim Exclusions** — statements outside eligible work, each with its reason.
- **Confidence Map** — facts classified established | partially established | unresolved | unreliable, each tied to source.
- **Glossary Terms** — technical phrases the PD uses exclusively.
- **Build Order** — order sections and paragraphs are generated per Writer Profile.
- **Self-check** — a check attached to a paragraph, run before it is shown.
- **Compliance Note** — per section: instructions applied / not applied with reason.
- **Deviation / Deviation Inventory / Coordinated Revision / Completion Report** — the one-pass correction chain.
- **Proposal** — edits the assistant proposes and a human applies.
- **Reference PD**, **Sol**, **Paired Comparison**, **Corrections-to-acceptable** — evaluation vocabulary.

"Idea seeds", "positioning tags", "running summary" are new terms with no prior definition.

## 2. FR / UJ / SM touching stepwise, gates, Build Order, plan-before-prose

| ID | Where | Substance | Status |
|---|---|---|---|
| FR-5 | prd.md:152–158 | Build Order honoured; ungated by default in `single`/`compare`; gated path "remains the existing `iterative` mode" | CAP-5; Story 2 done |
| FR-1 | prd.md:120–126 | Storyline derived before any section is drafted | CAP-1; done |
| FR-2..4 | prd.md:128–147 | Brief derived, visible/editable/never gating, reused by `(projectId, inputsHash, briefVersion)` | done |
| FR-7 | prd.md:168–173 | Compliance Note per section | done |
| FR-9 | prd.md:184–190 | Self-check before output, at most one repair | done |
| FR-12/13/14 | prd.md:207–226 | Deviation Inventory; one-pass Coordinated Revision + Completion Report | done |
| FR-15 | prd.md:228–232 | Reference PD comparison as Coordinated Revision | done |
| UJ-1 | prd.md:78–84 | Draft arrives section by section in Build Order | built |
| SM-C4 | prd.md:305 | Brief must not become a required step; time-to-first-draft with no Brief interaction must not grow | open |
| SM-C2 | prd.md:303 | time/cost within 2x today's single-mode run; baseline never measured (HANDOFF §7 item 4) | open |
| §6.2 | prd.md:285 | Per-section multi-select deferred to v2 `[NOTE FOR PM: revisit after Friday.]` | deferred |
| §5 | prd.md:272 | Non-goal: making multi-select the default path | deferred |
| OQ-5 | prd.md:313 | Must the Brief be approved before drafting for some writers (Michael's stepwise idea)? | open |

All six spec-pd-generation stories read `status: done`; HANDOFF-2026-09-11 is stale on this.

## 3. Michael's stepwise idea, as recorded

- addendum.md §A option D: "The tool proposes 2–5 options per section (context, limitations, uncertainties, experiments); writer selects before drafting." Rejected for MVP because it "adds interaction before the first draft (SM-C4)". Marked differentiated: no competitor offers per-section choice for long documents.
- reconcile-transcript.md line 16: 34:38–36:43 of the 2026-09-09 call; Michael at 35:58: "I think this version actually will be our most effective way to use this… I have an idea for that. I think we'll expand upon that on Friday." Reconciliation: "Michael's conviction about the stepwise flow is stronger than the PRD conveys."
- .memlog.md:55 — "gated stays as iterative and is the home for Michael's stepwise idea in v2."
- reconcile-transcript.md Gap 1 — Larry wants "an interactive pre-step where he challenges and distills [the Storyline] — a dialogue, not a form field".
- Option D was 2–5 options for ~4 buckets; the redesign is 3–5 seeds × 13 subsections: a superset never costed.

## 4. Spec kernel constraints (SPEC.md:100–112)

- Dump is the maximum required input; requiring a writer-authored artifact is out of contract.
- Locked Rules unchanged (caps s242 50/350, s244 100/700, s246 50/350; no fabrication).
- Every prose change is a Proposal a human applies.
- Ordered generation ungated by default in `single`/`compare`; gated path is `iterative` only (2026-09-09).
- Call budget: one Brief call; per section one generation + one Self-check + at most one repair; one consistency pass; ≤ 2x single-mode; overruns recorded in scorecard.
- Context budget 12 documents.
- Brief keyed by inputs, versioned, citations byte-validated against frozen `generationSources`.
- Paired Comparison never uses LLM self-scores.
- Convex per `convex/_generated/ai/guidelines.md`; vitest `convex/**`; bits-ui; max weight 500.

Data model (touchpoints.md): `generationBriefs` (projectId, inputsHash, briefVersion, origin), `generationBriefEntries`, `complianceNotes` rows (AD-25), `comparisons`; `convex/ai/brief.ts deriveOrReuseBrief`, `convex/lib/briefInputsHash.ts`, `convex/lib/glossaryMatcher.ts`, `convex/ai/selfCheck.ts`, `convex/lib/complianceNote.ts`. Ordered generation is a chain of per-section scheduled actions (AD-24). Spine bindings AD-23..AD-30.

Paragraph roles: product-domain 2026-09-15 (second) amendment: no paragraph counts or ordinal roles; QA scores by role. Live role lists in `convex/ai/prompts.ts:296, :405, :511` already enumerate the 13 subsections (242: company context, goal/problem, limitations of standard practice (passive uncertainties), technological objective, active uncertainties; 244: prior-year status (continuing only), workplan, hypothesis, experimentation/iterations; 246: overall advancement, specific advancements (one per resolved uncertainty), project status and next steps, project goal and improvements). Reuse these role ids verbatim.

## 5. Addendum mechanisms

Brief derivation is one structured call over trusted context; citations byte-validated; writer edits create a new version marked `writerEdited`. Self-check emits the Compliance Note as structured output alongside the section. Chat model Sonnet (`chatAgentV2.ts:279`); generation candidates incl. `openai/gpt-5.6-sol` via OpenRouter (`shared/generationModels.ts:29-56`); evidence budget 12 docs / 60k tokens / 5k per doc. No caching, model-routing or cost decision for many small calls exists.

## 6. Open questions to inherit / resolve

OQ-2 (which mode Larry uses; does he know `iterative` exists), OQ-5 (Brief-approval gate — this redesign is the answer), OQ-6 (cap 12→40), OQ-9 (Claim Exclusions retention). Gap 1: does Larry want to write the Storyline or approve it?

## 7. Contradictions to record as amendments

1. SPEC constraint (line 105) / FR-5: gating lives only in `iterative`. Seed approval is a gate: keep it inside the stepwise mode or amend.
2. prd §5/§6.2, SPEC non-goals: per-section multi-select was v2-only. Explicit reversal needed.
3. §4.1: "the Brief never gates generation." A signed-off running summary is a gate (in this mode only).
4. SM-C4: fails by construction for seed mode; re-scope to the non-stepwise modes.
5. Call budget: 13+ seed calls plus regenerations exceed the budget; needs its own budget.
6. Writer effort ceiling / SM-3 "zero writer-authored artifacts": distinguish authoring offline from choosing in-tool.
7. CAP-5 Build Order is section-granular; a 13-subsection order is finer than recorded today.
8. 2026-09-15 amendment: 1–2 bullets per subsection must not reintroduce de-facto paragraph counts; QA scores by role.
