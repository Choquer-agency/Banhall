# Addendum — Banhall PD generation: better than the dump

Depth that belongs downstream (architecture, solution design, evaluation) or earned a place but is not PRD narrative. Companion to `prd.md`; same Glossary.

## A. Options considered

| Option | What it is | Why not / why |
|---|---|---|
| A. Dump-only | Writer uploads everything; one-shot generation; no derived structure | The transcript already ran this: Larry gave the tool everything and Rev J was "marginally better" than Rev A. Every competitor that dumps-and-generates does so from structured engineering data (commits, tickets), never transcripts; the one upload-driven tool (Claimer) is staged and is the one criticised for shallow narratives. |
| B. Writer-supplied pre-documents | Larry's current practice: storyline, exclusion list, confidence map, glossary built offline | Works (self-score 70 → 80) but violates the effort ceiling; it is the symptom the PRD exists to remove. |
| C. System-derived Brief (chosen) | The system derives the four artifacts from the Dump, shows them, drafts against them | Dump-everything for the writer, structured generation for the model. No writer-authored artifact. Reuses the existing analyzer stage as the natural home. |
| D. Per-section multi-select (Michael) | The tool proposes 2–5 options per section (context, limitations, uncertainties, experiments); writer selects before drafting | Differentiated — no competitor or general drafting tool offers per-section choice for long documents (nearest: Sudowrite Brainstorm, Copilot Rewrite). Deferred to v2 because it is C at paragraph granularity with choices, and because it adds interaction before the first draft (SM-C4). |

## B. Code anchors (from `extract-codebase.md`, HEAD c55014f)

- Program modes `single | compare | iterative` — `convex/ai/promptProgram.ts:222-249`. `iterative` already runs 242 → 244 → 246 with human review and approved-prior-section context (`:235-248`); `single/compare` run the three sections in parallel (`:250-260`). FR-5 makes the ordering the default but ungated in single/compare: prior-section context is the *drafted* section, not an approved one, so it is a weaker guarantee than `iterative`'s — compensated by the assembled-draft consistency pass.
- Post-generation QA + chronology with two-attempt repair — `promptProgram.ts:336-353`, `convex/ai/postQa.ts`. FR-9 extends this to a per-section pre-display check against the Brief and profile.
- Input trust order — `convex/ai/prompts.ts:833-847` (Writer's Notes highest). Precedence locked > org > writer > house — `docs/product-domain.md:1354-1356`; org mode `enforced` ignores writer waivers — `convex/writerProfiles.ts:207-214`. House Rule categories — `shared/styleOverrides.ts:22-28`. Locked limits — `convex/lib/lineLimits.ts:15-18` (s242 50/350, s244 100/700, s246 50/350).
- Writer profile applies only when enabled — `convex/writerProfiles.ts:222-224`; org modes `writer_choice|enforced|off` — `:206-211`. FR-8 requires the "not applied" state to be reported.
- Edit tools — `convex/ai/chatAgentV2.ts:37` (`makeProposeEdit`), `:114/:270` (`makeProposeBulkEdits`), `convex/lib/passageEdits.ts` (unique, non-overlapping targets). FR-13's Completion Report is the missing half: bulk edits exist, per-item accounting does not.
- Chat history window 30 rows — `chatAgentV2.ts:250-256`; evidence budget 12 docs / 60k tokens / 5k per doc — `convex/ai/chatEvidence.ts:81-87`; analyzer context 12 docs — `convex/ai/trustedContext.ts:185`; admin caps — `appSettings.ts:26,122,152-155`. FR-11, FR-17.
- Models — chat fixed to Sonnet (`chatAgentV2.ts:279`); generation candidates incl. `openai/gpt-5.6-sol` via OpenRouter (`shared/generationModels.ts:29-56`). Open Question 3.
- Existing eval — `scripts/chat-behavior-eval.mjs` (live-model, opt-in). FR-13/FR-14 fixtures belong there.
- Allowed attachment types — `shared/documentStatus.ts:24-40`. No DWG/DXF.
- Sept 8 intake findings vs PR #8: bulk editing and conditional-profile fallback addressed; context completeness (finding 3) not addressed → FR-11.

## C. Mechanism sketch (for architecture, not binding)

1. **Brief derivation** as a new stage between analyzer and section generation: one structured call over the trusted context producing `{storyline, claimExclusions[], confidenceMap[], glossaryTerms[]}` with source citations validated against frozen `generationSources` rows (same byte-for-byte rule as provenance). Keyed by `(projectId, inputsHash, briefVersion)`; stored; writer edits create a new version marked `writerEdited`.
2. **Ordered generation**: promote the `iterative` ordering (with prior-section context) to the default; the Build Order comes from the profile when present.
3. **Self-check**: extend the section call's `two-attempt-repair` policy with checks for exclusion presence, glossary synonyms, profile paragraph rules and caps; emit the Compliance Note as structured output alongside the section.
4. **Deviation Inventory / Coordinated Revision**: a chat tool that reads stored Compliance Notes + profile, produces the inventory; `proposeBulkEdits` extended with a per-item `{status: resolved|blocked|conflicting, reason}` array that the reply must echo; the harness asserts N/N.
5. **"Make it better" guard**: a prompt-level rule plus a live-model fixture in `chat-behavior-eval.mjs` that fails on any request for a writer-authored artifact.
6. **Call budget** (PRD Cross-Cutting NFRs): one Brief call; per section one generation call, one Self-check call, at most one repair call; one assembled-draft consistency pass (FR-5); the Deviation Inventory and Coordinated Revision are chat-side and outside the generation budget. Overruns (a second repair, a re-derived Brief) are logged to the scorecard.
7. **Paired Comparison**: a `comparisons` table `{projectId, generationId, baselineLabel, judge, preference, deviations:{banhall, baseline}, corrections:{banhall, baseline}, date}`; a small admin page or script to record comparison results. Baseline drafts are pasted in.

## D. Measurement protocol (Paired Comparison)

- Projects: at least five. 25001 (Larry, Reference PD exists) is the development project and is reported separately; at least two projects untouched during Brief/Self-check development; at least one 100–200-hour project; Reference PDs from Larry or Tracy.
- Inputs: identical files and settings text into ChatGPT (Sol, a fresh project with the same files) and into Banhall (Sol). Record product and model versions and the model-equivalence caveat (OQ3) on every record; consider a Sonnet/Opus arm.
- Blinding: a third person (not the judge) strips both drafts to identically formatted plain text — no Compliance Notes, Brief, glossary callouts or tool-specific headings; drafts labelled A/B, order randomised per project; judge = the writer who owns the project; a second judge (Michael) where available.
- Counts: Deviations counted by the writer, using the same manual method for both drafts, against their settings, without using FR-12's inventory for either; Corrections-to-acceptable = number of revision rounds until the writer says "acceptable".
- Do not use LLM self-scores as the outcome (research: grade inflation, length bias).
- Schedule: Larry is on vacation the week of September 15; judging starts on his return.

## E. Research pointers

- `extract-web-research.md`: Sudowrite Story Bible / Brainstorm, Jasper Brand Voice, Copilot Keep/Discard/Regenerate, ChatGPT canvas per-suggestion accept; Self-Refine and Reflexion; partial-completion of long edit lists; ~39% multi-turn adherence drop (Microsoft Research).
- `extract-competitor-mechanisms.md`: Boast (capture from Git/Jira, in-house narrative outline), Grant Sparrow (guided intake), Claimer (staged: eligibility → gathering → drafting → validation), SRED AI (GitHub-only, evidence index), Neo.Tax (tickets → narrative; "generic LLMs alone are unreliable"); CRA Pre-Claim Approval 2026-04-01, no CRA guidance on AI.

## F. CAD/DWG (backlog, October)

No mainstream LLM reads DWG. Path when scheduled: ODA File Converter (free CLI) DWG → DXF/PDF/PNG; ezdxf for DXF text extraction; PDF/PNG then flow through existing document ingestion. ~10% of Larry's PDs.

## G. Larry's inputs still to reconcile

Customized-settings document (decides Open Question 1 and most of §4.2), 25001 Rev A/G/J, the shared ChatGPT thread (hello@choquer.agency). Reconcile via Finalize step 2 when they arrive.
