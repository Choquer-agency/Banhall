---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted: ['step-01-detect-mode', 'step-02-load-context', 'step-03-risk-and-testability', 'step-04-coverage-plan', 'step-05-generate-output']
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-09-10'
runScope: 'epic-level'
runKey: 'epic-pd-generation'
---

# Test Design: Epic `pd-generation` — PD generation: better than the dump

**Date:** 2026-09-10
**Author:** Johnny (TEA workflow, unattended run — every choice the workflow would have asked about is recorded in *Assumptions*)
**Status:** Draft
**Contract:** `_bmad-output/specs/spec-pd-generation/SPEC.md` (CAP-1..CAP-17) + `measurement-protocol.md` (SM-1..SM-5, SM-C1..SM-C5). Every test below names the CAP or SM it proves.

---

## Executive Summary

**Scope:** Epic-level test design for the six stories in `stories.yaml` (schema/Brief, pipeline, profile precedence, Brief UI, chat convergence, Paired Comparison eval), covering the Generation Brief, ordered ungated generation with Compliance Notes, profile precedence, the Coordinated Revision and Completion Report, and the Paired Comparison protocol.

**Risk Summary:**

- Total risks identified: 22
- High-priority risks (≥6): 11 (two at 9: R-001 Storyline contradiction repaired away; R-006 Completion Report drops items)
- Critical categories: BUS (contract behaviours the writer sees), DATA (provenance and metric integrity), TECH (per-section action chain and gate regressions)

**Coverage Summary (automated, ranges — see Resource Estimates):**

- P0 scenarios: 16 (~20–30 hours)
- P1 scenarios: 62 (~45–75 hours)
- P2/P3 scenarios: 31 (~12–25 hours)
- Manual protocol steps: 12 (Paired Comparison; judging starts after 2026-09-15)
- **Total effort**: ~80–130 hours (~2–3.5 weeks of one engineer, in parallel with implementation; most tests are the enforcing tests the architecture spine already names per AD)

**Test levels used in this plan**

| Level | Runner | Where it runs | Notes |
|---|---|---|---|
| **UNIT** | vitest, node (`shared`, `src`, pure `convex/lib` modules) | `npm test` inside `loop-verify.sh` | Pure functions: hash, matcher, validators, SM arithmetic |
| **INT** | vitest `convex` project, `convex-test`, edge-runtime | `npm test` inside `loop-verify.sh` | Convex functions with real schema; model calls stubbed at the provider boundary |
| **CMP** | vitest browser mode, `vitest-browser-svelte`, headless Chromium | `npm run test:component` (second CI job; run locally before touching `src/lib/components`) | `*.component.test.ts`; never add `sveltekit()` to the config |
| **HRN** | `scripts/chat-behavior-eval.mjs` (live model, opt-in, billable) | Nightly / pre-release, needs `ANTHROPIC_API_KEY` | The only place "every run" claims (SM-2) can be observed |
| **MAN** | Human protocol (`measurement-protocol.md`) | After Larry returns (week of 2026-09-22) | Paired Comparison; never automated (SPEC non-goal) |
| **AUDIT** | vitest `source-audit` project (greps source) | `npm test` | Writer-count and import-direction invariants |

---

## Not in Scope

| Item | Reasoning | Mitigation |
|---|---|---|
| **Automating the ChatGPT baseline** | SPEC non-goal; baseline is produced manually by the writer | Manual protocol steps MP-02/MP-03 |
| **Raising the context cap toward 40** | SPEC constraint: budget stays at 12 (admin-configurable); only visibility ships | TD-CTX-* prove visibility; Q16 owns the trigger |
| **Per-document trust-order display** | PRD v1.1 | Inclusion rows tested in attachment order only |
| **CAD/DWG ingestion, Brain ingestion, role permissions, client uploader** | SPEC "untouched" list | Interworking regression only (existing suites must stay green) |
| **LLM self-score as an outcome** | SPEC: never an outcome | TD-CMP-08 asserts comparison metrics never read tool counts |
| **Prose quality of generated sections** | Not deterministic; judged by the writer in the Paired Comparison | HRN fixtures assert contract shape, not prose |
| **Playwright E2E against a deployed app** | No Playwright E2E project exists in the repo; the gate is browser-free by default | CMP suites cover UI behaviour; the live pipeline is proven through INT with stubbed providers |
| **Retention period of stored Claim Exclusions (Q17)** | Open question owned by Michael | Recorded as dependency D-4 |

---

## Risk Assessment

Probability 1–3 (unlikely / possible / likely), Impact 1–3 (minor / degraded / critical). Score = P × I. ≥6 must be mitigated before release; 9 blocks the gate until mitigated or waived.

### High-Priority Risks (Score ≥6)

| Risk ID | Category | Description | P | I | Score | Mitigation | Owner | Timeline |
|---|---|---|---|---|---|---|---|---|
| R-001 | BUS | Self-check repairs a section into line with a derived Storyline when the section's evidence is stronger, instead of raising a Storyline question (story 1 names this "the riskiest design point"; CAP-1) | 3 | 3 | 9 | Contradiction fixture is P0 (TD-BRF-03/04); Storyline-question write path is the only allowed write outside `complianceNotes` (AUDIT) | Dev (story 1/2) | Before story 2 review |
| R-006 | BUS | Coordinated Revision accounts for fewer than N items (the "4 of 16" behaviour Larry reported; CAP-13, SM-2) — items lost between tool findings and reply | 3 | 3 | 9 | `superRefine` full-coverage validator unit tests; `chatProposalItems` rows echoed 1:1 (INT); live 16-item HRN fixture; re-run Larry's Rev G list first (Open Question 7) | Dev (story 5) | Before story 5 review |
| R-002 | DATA | Brief entries cite nothing, or a failed byte-match is silently kept — provenance broken, draft contains unexplained content (CAP-2, constraint "nothing in the draft is unexplained") | 2 | 3 | 6 | Byte-match validation tests mirror `createProvenance`; dropped-entry counter asserted | Dev (story 1) | Story 1 |
| R-003 | TECH | Ordered chain regresses a gate: an approval checkpoint appears in `single`/`compare`, or `iterative` loses its gate; or three sections crammed into one action exceed the five-slot budget (AD-24) | 2 | 3 | 6 | Gate-absence and gate-presence tests are P0; scheduler-call count asserts per-section actions | Dev (story 2) | Story 2 |
| R-004 | BUS | A profile instruction is dropped without a Compliance Note row (silent override — the complaint already filed twice; CAP-6/7, SM-4) | 2 | 3 | 6 | N-instructions → N-rows test; injected unfollowable instruction; six categories × two modes matrix | Dev (story 2/3) | Story 3 |
| R-008 | DATA | SM-1/SM-2 computed including development or voided projects, or from tool-produced counts (CAP-16) | 2 | 3 | 6 | Exclusion tests P0; AUDIT that `comparisons.ts` never imports `chatProposalItems`/`complianceNotes` readers | Dev (story 6) | Story 6 |
| R-012 | BUS | An unresolved or unreliable fact is stated flatly in the prose (CRA defensibility under Pre-Claim Approval; CAP-9) | 2 | 3 | 6 | Hedging fixture P0 (flat statement fails, hedged passes) | Dev (story 2) | Story 2 |
| R-014 | OPS | Live-model harness is non-deterministic and billable; "16/16 on every run" cannot be proven in PR CI | 3 | 2 | 6 | Deterministic contract tests carry the gate (INT/UNIT); HRN runs nightly with a burn-in of ≥3 consecutive runs before release; results archived under `.audit/chat-behavior` | QA/Dev | Nightly from story 5 |
| R-016 | OPS | Vacuous tests (`test.skip`, `expect(true).toBe(true)`) count as coverage — present today in `convex/ai/brief.test.ts` | 3 | 2 | 6 | Gate already refuses skipped/vacuous tests (commit fd9dcfc); this plan lists the real cases that replace each stub | Dev (story 1) | Story 1 |
| R-018 | DATA | `complianceNotes` persisted as a JSON string on `generations` (story 2 partial work) instead of rows with `paragraphIndex` (AD-25) — the Deviation Inventory cannot list paragraphs and the Editor cannot scope lines | 3 | 2 | 6 | Schema-shape INT test and index test are P1 and must fail against the current string field | Dev (story 2) | Story 2 |
| R-011 | DATA | Brief reuse keyed wrongly: a Storyline edit or digest changes `inputsHash`, or reuse picks a stale version; concurrent edits clobber | 2 | 3 | 6 | Hash exclusion tests; MAX(version) reuse; `BRIEF_STALE` | Dev (story 1) | Story 1 |

### Medium-Priority Risks (Score 3–5)

| Risk ID | Category | Description | P | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|---|
| R-005 | PERF | Call budget overrun (repair loop, unnamed extra call) pushes latency/cost past 2x and is absorbed silently (SM-C2, AD-27) | 2 | 2 | 4 | Slot enum + per-slot count + `overrun` flag tests; single-repair test | Dev (story 2) |
| R-009 | BUS | A document cut by the context cap is described as used, or the cut is only in operator logs (CAP-11/17) | 2 | 2 | 4 | Per-row `inclusion` written and returned; prompt-assembly exclusion test; CMP inclusion rows | Dev (story 2/4) |
| R-010 | TECH | Editor and DOCX export diverge on headings/paragraphs; `exportTemplateDocx` imported in SSR path (known pitfall) | 2 | 2 | 4 | Parity UNIT test on the shared document model; import-site AUDIT | Dev (story 2) |
| R-013 | TECH | Glossary matcher below 95% on the fixture, or model classification called for unflagged candidates | 2 | 2 | 4 | Fixture threshold test (existing file, make it real); classification spy | Dev (story 1) |
| R-015 | SEC | `briefs.saveEntryEdit` or `comparisons.record` callable without the right capability | 2 | 2 | 4 | Authorization-branch INT tests (spine convention: every new mutation ships one) | Dev |
| R-017 | BUS | "Make it better" reply asks the writer for a Storyline/Glossary/document (effort-ceiling violation, CAP-14) | 2 | 2 | 4 | HRN guard fixture; missing-facts source test (INT) | Dev (story 5) |
| R-019 | TECH | Settings document supplied as Writer's Notes or attachment not detected → three supply paths produce different Compliance Notes (CAP-8) | 2 | 2 | 4 | Three-path equality INT test | Dev (story 3) |
| R-020 | OPS | Model-equivalence caveat (Q15) absent from comparison records → SM-1 contestable | 2 | 2 | 4 | `modelCaveat` required non-empty | Dev (story 6) |
| R-021 | TECH | Stop-after-section leaves a report without three H2 headings (AD-8 contract) | 2 | 2 | 4 | Tiptap placeholder test | Dev (story 2) |
| R-007 | SEC | Brief content reaches Brain nomination, the retriever, or another project | 1 | 3 | 3 | AUDIT + INT nomination test | Dev (story 1) |

### Low-Priority Risks (Score 1–2)

| Risk ID | Category | Description | P | I | Score | Action |
|---|---|---|---|---|---|---|
| R-022 | BUS | Draft length creeps toward the caps (SM-C1) because repairs pad rather than tighten | 2 | 1 | 2 | Monitor: word counts recorded on the scorecard; compare across HRN runs |

### Risk Category Legend

- **TECH**: Technical/Architecture (flaws, integration, scalability)
- **SEC**: Security (access controls, auth, data exposure)
- **PERF**: Performance (SLA violations, degradation, resource limits)
- **DATA**: Data Integrity (loss, corruption, inconsistency)
- **BUS**: Business Impact (UX harm, logic errors, revenue)
- **OPS**: Operations (deployment, config, monitoring)

---

## NFR Planning

**Purpose:** thresholds, planned validation and the evidence `nfr-assess` will consume later. No PASS/CONCERNS/FAIL here.

| NFR Category | Requirement / Threshold | Risk Link | Planned Validation | Evidence Needed |
|---|---|---|---|---|
| Performance / cost | End-to-end time and cost ≤ 2x today's single-mode run (SM-C2, SM-C4); per generation ≤ 1 brief + per section (1 gen + 1 selfCheck + ≤1 repair) + 1 consistency | R-005 | INT: `aiUsage` rows per generation counted by slot; `overrun` flagged. Baseline: measure today's single-mode call count and wall time on the dev deployment before story 2 merges | `aiUsage` per-slot report on the scorecard; baseline note in `.audit/` |
| Privacy | Brief content project-scoped; never enters Brain nomination or another project (SPEC constraint, AD-19) | R-007 | AUDIT + INT nomination test | Test report |
| Security | New mutations (`saveEntryEdit`, `comparisons.record`, `stopOrderedGeneration`) enforce capability; comparisons admin-only until Q18 | R-015 | INT authorization branch per mutation | Test report |
| Reliability | A chain stalled between sections is recovered by `failStaleGenerations`; terminal status never overwritten (AD-2/AD-5) | R-003 | INT reaper test with a stalled section action | Test report |
| Compliance | Locked Rules unchanged (242/244/246 skeleton; caps s242 50/350, s244 100/700, s246 50/350; no fabrication); no tool mutates prose directly | R-004, R-006 | UNIT cap constants; INT `applyProposal` untouched regression; AUDIT no new `reports` prose writer | Test report + `docs/product-domain.md` amendment present |
| Maintainability | Gate refuses skipped or vacuous tests; every AD-named enforcing test exists in the PR that touches its guarded list | R-016 | `scripts/check-test-discovery.mjs` in `loop-verify.sh` | Gate log |
| Accessibility | WCAG 2.2 AA floor on Brief rail, compliance line, completion rows (`EXPERIENCE.md`) | — | CMP: `aria-expanded`, `aria-live="polite"`, pill text present, 44px targets | Component test report |

**Unknown thresholds:** the numeric baseline for "today's single-mode run" (calls, seconds, dollars) is not recorded in any artifact — **UNKNOWN**; it must be measured before SM-C2 can be judged (dependency D-3). The "substantially rewritten" threshold for SM-C5 (Storyline edit distance) is **UNKNOWN**; the test asserts the magnitude is stored, not a threshold.

---

## Entry Criteria

- [ ] Story markdown exists for stories 3–6 with acceptance criteria (today only 1–2 exist; this plan uses SPEC CAP success statements in their place — assumption A-2)
- [ ] `npx convex codegen` reflects the epic schema (`generationBriefs`, `generationBriefEntries`, `complianceNotes` rows, `chatProposalItems`, `comparisons`); story 1 records this as a deferred toolchain item
- [ ] `npm ci` fresh; `npx playwright install chromium` for CMP suites
- [ ] Fixture corpus checked in under `convex/ai/__fixtures__/` or equivalent: contradiction transcript, three-Transcript disagreement set, adversarial paraphrase corpus, synonym fixture, unreliable-fact fixture, 16-item mixed Deviation list (assumption A-6 on location)
- [ ] Baseline single-mode call count and duration measured and recorded (D-3)
- [ ] `ANTHROPIC_API_KEY` available for HRN runs (nightly only)

## Exit Criteria

- [ ] All P0 tests passing in `bash scripts/loop-verify.sh` (browser-free) and `npm run test:component`
- [ ] All P1 tests passing or failures triaged with an owner
- [ ] R-001 and R-006 (score 9) mitigated with their P0 tests green — no waiver
- [ ] No open P0/P1 bugs in the epic's surfaces
- [ ] HRN: 16-item fixture reports 16/16 on three consecutive nightly runs; "converge" guard passes on the same runs
- [ ] `docs/product-domain.md` carries the four-tier / no-silent-tier / effort-ceiling amendment
- [ ] Paired Comparison protocol dry-run (MP-01..MP-12) completed once on 25001 before Larry's judging week

## Project Team

| Name | Role | Testing Responsibilities |
|---|---|---|
| Johnny | Owner / tech lead | Approves plan; owns Q15/Q16; measures the SM-C2 baseline |
| Michael | Product direction (Banhall) | Owns Q17; second judge; signs off the comparison set |
| Larry, Tracy | Writers / judges | Paired Comparison judging and manual Deviation counts; weekly SM-3 self-report |
| bmad-loop dev sessions | Implementation | Write the enforcing tests named per AD in the same PR as the code |
| Third person (not the judge) | Blinding | Strips drafts to plain text (MP-04) |

---

## Test Coverage Plan

> **P0/P1/P2/P3 is priority, not execution timing.** Execution timing is in *Execution Strategy*. Test IDs: `PDG.{story}-{LEVEL}-{seq}`. Each row names its CAP/SM anchor and the file the touchpoints/spine already designate.

### P0 (Critical)

**Criteria**: critical business, data-integrity, or compliance impact with no safe workaround. Risk score is supporting evidence, not a required condition.

| ID | Requirement (CAP/SM) | Scenario | Level | Risk | File |
|---|---|---|---|---|---|
| PDG.1-INT-003 | CAP-1 | Contradiction fixture: a section's evidence entry is `established`, the Storyline claim's basis is `partial`; Self-check inserts exactly one `storylineQuestion` entry on the current Brief version with `questionText`, both sides' source ids, `resolvedBy` unset; the section is **not** repaired; generation reaches `completed` | INT | R-001 | `convex/ai/brief.test.ts` |
| PDG.1-INT-006 | CAP-2 | Every derived entry: `sourceContentHash` equals the frozen `generationSources.contentHash` and `content.slice(startOffset,endOffset) === exactExcerpt`; an entry with a wrong offset is dropped, the drop counted on the Brief, and the generation continues | INT | R-002 | `convex/ai/brief.test.ts` |
| PDG.1-INT-012 | CAP-4 | Two consecutive generations with identical inputs share one `briefId`; the provider stub records zero `generation:brief` calls on the second run | INT | R-011 | `convex/ai/brief.test.ts` |
| PDG.2-INT-001 | CAP-5 | `single` mode: generation record lists production order `242 → 244 → 246`; the 244 call's prompt contains the drafted 242; the 246 call's prompt contains 242 and 244; sections never run in parallel (scheduler order asserted) | INT | R-003 | `convex/ai/promptProgram.test.ts` (new) |
| PDG.2-INT-004 | CAP-5 | `single` and `compare`: no `awaiting_input` status and no `approveSectionDraft` call between sections; each section becomes readable at `shown` before the next starts | INT | R-003 | `convex/ai/promptProgram.test.ts` |
| PDG.2-INT-005 | CAP-5 | `iterative` regression: the approval gate remains (`awaiting_input` after each section; `approveSectionDraft` required to continue); one-shot ghost candidate still runs | INT | R-003 | `convex/ai/promptProgram.test.ts` / existing iterative tests |
| PDG.2-INT-010 | CAP-9 | Section containing a Claim Exclusion → one `generation:repair:<n>` call; `complianceNotes` row `outcome=not_applied|applied`, `repaired=true`; excluded text absent from the shown section or flagged | INT | R-004 | `convex/ai/selfCheck.test.ts` (new) |
| PDG.2-INT-013 | CAP-9 | Unreliable-fact fixture: flat statement fails the check; hedged prose ("the team was unable to confirm…") passes; Confidence Map `unresolved` treated the same | INT | R-012 | `convex/ai/selfCheck.test.ts` |
| PDG.2-INT-014 | CAP-9 / SM-C2 | Repair fails → section shown with the `repair_failed` flag; **no second** repair call; note records the outcome | INT | R-005 | `convex/ai/selfCheck.test.ts` |
| PDG.2-INT-020 | CAP-7 / SM-4 | Profile with N=6 relevant instructions → the section's Compliance Note holds exactly N outcome rows; no instruction absent | INT | R-004 | `convex/writerProfiles.test.ts` |
| PDG.3-INT-001 | CAP-6 | Six categories × `writer_choice`: a profile instruction contradicting each House Rule category is applied; per-category outcome `{category, mode, effective, tier: writer_profile}` | INT | R-004 | `convex/writerProfiles.test.ts` |
| PDG.3-INT-002 | CAP-6 | A category `enforced`: the House Rule applies; outcome `tier: org_enforced`; the Compliance Note row names it org-enforced | INT | R-004 | `convex/writerProfiles.test.ts` |
| PDG.5-INT-004 | CAP-13 / SM-2 | Given N=16 items (14 rule + 2 content), the turn holds exactly one Proposal tool call and 16 `chatProposalItems` rows; reply text echoes all 16 ids/statuses (model stubbed to return the tool call) | INT | R-006 | `convex/chatProposalItems.test.ts` (new) |
| PDG.5-INT-007 | CAP-13 / constraint | `applyProposal` unchanged: a Coordinated Revision is not applied without the human mutation; `saveProposal` remains the only `chatProposals` insert | INT + AUDIT | R-006 | `convex/chatProposals.test.ts` (extend) |
| PDG.6-INT-004 | CAP-16 / SM-1, SM-2 | SM-1/SM-2 queries exclude rows with `usedInDevelopment=true` and rows referenced by a `voidsComparisonId`; a set with 25001 + 4 others computes from the 4 | INT | R-008 | `convex/comparisons.test.ts` (new) |
| PDG.4-INT-002 | CAP-17 / CAP-11 | 40 documents attached, budget 12: `generationSources` rows carry `inclusion` = 12 `included`, N `condensed`, rest `not_included`, plus `includedLength`; one query returns them per generation | INT | R-009 | `convex/ai/trustedContext.test.ts` |

**Total P0**: 16 tests

### P1 (High)

**Criteria**: core, frequent or complex behaviour with material user reach and a limited workaround.

#### Story 1 — Generation Brief (CAP-1, CAP-2, CAP-4)

| ID | CAP | Scenario | Level | Risk | File |
|---|---|---|---|---|---|
| PDG.1-INT-001 | CAP-1 | No Storyline supplied → Brief `origin=derived`; storyline entries exist; each cites a source; the section prompts contain the rendered Storyline (delimited data block) | INT | R-002 | `brief.test.ts` |
| PDG.1-INT-002 | CAP-1 | Writer-supplied Storyline: `reserveGeneration` freezes a `writer_storyline` source row; Brief `origin=writer`, `storylineText` verbatim (including odd whitespace, never parsed/rejected); `inputsHash` identical with and without it | INT | R-011 | `brief.test.ts` |
| PDG.1-INT-004 | CAP-1 | Weaker section evidence (`partial`) vs `established` Storyline basis → no Storyline question; ordinary repair path | INT | R-001 | `brief.test.ts` |
| PDG.1-INT-005 | CAP-1 | Three Transcripts that disagree on one fact → one Storyline; the disagreement is two `confidenceMap` entries citing different transcripts, not averaged | INT | R-002 | `brief.test.ts` |
| PDG.1-INT-007 | CAP-2 | Every `claimExclusion` row carries `reason` ∈ {business_risk, routine_engineering, outside_claim_period, not_technological}; a model output without a reason is repaired (two-attempt) or dropped, never stored | INT | R-002 | `brief.test.ts` |
| PDG.1-UNIT-009 | CAP-2 | Glossary matcher synonym fixture: ≥95% of known synonyms matched by exact + inflected rules (plural, past tense, hyphenation); threshold computed by `validateGlossaryFixture`; fixture never lowered | UNIT | R-013 | `convex/lib/glossaryMatcher.test.ts` (replace stubs) |
| PDG.1-INT-013 | CAP-4 | Adding a Transcript → new `inputsHash`, `version=1` for the new key; every entry stamped `change` ∈ {added, removed, unchanged} against the previous version's set keyed `(group, sourceContentHash, startOffset, endOffset)` | INT | R-011 | `brief.test.ts` |
| PDG.1-INT-014 | CAP-3 | `briefs.saveEntryEdit` → version N+1, `origin=edited`, `editMagnitude {changedEntriesCount, storylineEditDistance}`; version N rows untouched | INT | R-011 | `brief.test.ts` |
| PDG.1-INT-015 | CAP-3 | After an edit, the next generation with the same `inputsHash` reuses version N+1 (MAX(version)) and the edited text appears verbatim in the section prompt | INT | R-011 | `brief.test.ts` |
| PDG.1-INT-017 | CAP-1 | `saveEntryEdit` resolves a `storylineQuestion`: `use_evidence` rewrites `storylineText` and sets `resolvedBy`; `keep_storyline` records the choice and leaves the text | INT | R-001 | `brief.test.ts` |
| PDG.1-INT-020 | Constraint (privacy) | Brief rows never appear in `brainSources` nomination candidates or retriever results for the project; a second project's generation cannot read them | INT + AUDIT | R-007 | `brief.test.ts`, source audit |
| PDG.1-UNIT-022 | AD-23 | `promptProgram` topology: `brief` stage present in all three `modes.*` arrays immediately after `analyzer`; `calls.brief.callSite === "generation:brief"`, policy `two-attempt-repair` | UNIT | R-003 | `convex/ai/promptScaffolds.test.ts` (extend) |
| PDG.1-INT-023 | Convention | `saveEntryEdit` authorization branch: a user without report edit access is refused (`NOT_AUTHORIZED`) | INT | R-015 | `convex/briefs.test.ts` (new) |

#### Story 2 — Ordered generation, Self-check, Compliance Notes (CAP-5, CAP-7, CAP-9, CAP-10)

| ID | CAP | Scenario | Level | Risk | File |
|---|---|---|---|---|---|
| PDG.2-INT-002 | CAP-5 | Profile `buildOrder: ["246","242","244"]` → produced in that order; prior-section context follows production order | INT | R-003 | `promptProgram.test.ts` |
| PDG.2-INT-003 | CAP-5 | Invalid Build Order (`"999"`, duplicates `["242","242","246"]`) → default order, no throw; Compliance Note records the fallback reason | INT | R-003 | `writerProfiles.test.ts` |
| PDG.2-INT-006 | CAP-5 | `stopOrderedGeneration` after 242: 244 never scheduled; `stoppedAfterSection="242"`; generation `completed`; `buildTiptapDocument` renders three H2s with `[NOT GENERATED]` bodies under 244/246 | INT | R-021 | `promptProgram.test.ts`, `convex/lib/tiptapReport.test.ts` |
| PDG.2-INT-008 | CAP-5 | Consistency pass: exactly one `generation:consistency` call, scheduled after the last section draft and before it is marked `shown` | INT | R-005 | `promptProgram.test.ts` |
| PDG.2-INT-009 | CAP-5 | `compare`: chain runs once per candidate; every `complianceNotes` row and section run carries `candidateRunId`; `selectReportCandidate` makes the selected candidate's rows the report's | INT | R-003 | `convex/ai/pipeline.compare.test.ts` (extend) |
| PDG.2-INT-010b | CAP-5 / AD-24 | Each section is its own scheduled action (scheduler invoked once per section, not one action running all three); per-action slot count ≤ 5 | INT | R-003 | `promptProgram.test.ts`, `convex/ai/providers.test.ts` |
| PDG.2-INT-011 | CAP-9 | Off-glossary synonym in a draft → matcher flags it; repair replaces with the Glossary Term or the row records `not_applied` with reason | INT | R-013 | `selfCheck.test.ts` |
| PDG.2-INT-012 | CAP-9 | Cap breach (s242 draft 400 words) → repair; note records the actual count and outcome; s244 700 / s246 350 constants unchanged | INT | R-004 | `selfCheck.test.ts`, `convex/lib/lineLimits.test.ts` |
| PDG.2-INT-015 | CAP-9 | Self-check outcomes and repair counts summarised into `generations.qa` scorecard | INT | R-005 | `selfCheck.test.ts` |
| PDG.2-INT-016 | CAP-9 / AD-25 | `paragraphIndex` set (0-based within section, per `src/lib/reportSections.ts`) on every paragraph-rule and model row; section-level rows leave it unset | INT | R-018 | `selfCheck.test.ts` |
| PDG.2-INT-021 | CAP-7 | Injected unfollowable instruction ("write section 244 in 2,000 words") → `not_applied` row, `tier=locked`, reason names the cap | INT | R-004 | `writerProfiles.test.ts` |
| PDG.2-INT-022 | CAP-7 / AD-25 | Schema: `complianceNotes` is a table with `by_generationId_and_section` and `by_generationId_and_candidateRunId_and_section`; no `generations.complianceNotes` string field is read by any consumer (fails against today's partial work by design) | INT + AUDIT | R-018 | `convex/schema` test, source audit |
| PDG.2-INT-023 | CAP-7 / AD-26 | Deterministic rows copy `tier` verbatim from `getEffectiveWriterStyle`; changing `resolveEffectiveOverrides` output alone does not change a stored tier | INT | R-004 | `writerProfiles.test.ts` |
| PDG.2-UNIT-030 | AD-27 | Slot enum in `instrument.ts`: `generation:brief|section:<n>|selfCheck:<n>|repair:<n>|consistency|compression|qa|chronology` accepted; any other `generation:*` label rejected by the validator | UNIT | R-005 | `convex/ai/instrument.test.ts` |
| PDG.2-INT-031 | AD-27 / SM-C2 | Per-slot counts on the scorecard; a second `repair:244` sets `overrun=true`; no call is refused (alert only) | INT | R-005 | `instrument.test.ts` |
| PDG.2-UNIT-040 | CAP-10 | Editor/DOCX parity: for a generated document, headings and paragraph sequence from `buildTiptapDocument` equal those the export builder emits (compare the shared model, not bytes); `exportTemplateDocx` imported only inside browser-only code paths (AUDIT) | UNIT + AUDIT | R-010 | `src/lib/exportValidation.test.ts`, `convex/lib/tiptapReport.test.ts` |
| PDG.2-INT-041 | CAP-11 | Over-budget Transcript → `condensed`; Confidence Map entries sourced from the digest cite a `transcript_digest` row and are marked as digest-sourced | INT | R-009 | `trustedContext.test.ts`, `brief.test.ts` |
| PDG.2-INT-042 | CAP-17 | Prompt assembly never includes a `not_included` document and never labels it as used in any progress-log sentence (`describeContextCuts`) | INT | R-009 | `trustedContext.test.ts` |
| PDG.2-INT-043 | Reliability | A chain stalled between sections is failed by `failStaleGenerations` after the 30-minute window; no new reaper | INT | R-003 | `convex/generationReaper.test.ts` (extend) |

#### Story 3 — Precedence and Writer Profile fidelity (CAP-6, CAP-8)

| ID | CAP | Scenario | Level | Risk | File |
|---|---|---|---|---|---|
| PDG.3-INT-003 | CAP-6 | Instruction exceeding the s246 line cap → applied up to 50 lines; outcome `tier=locked`; note copy names the CRA limit and "locked" | INT | R-004 | `writerProfiles.test.ts` |
| PDG.3-INT-007 | CAP-8 | The same settings text supplied (a) as the saved profile, (b) as Writer's Notes, (c) as an attached document → identical Compliance Note rows (same instruction set, outcomes, tiers) | INT | R-019 | `writerProfiles.test.ts` |
| PDG.3-INT-008 | CAP-8 | Disabled profile → `profileState=disabled`; the Brief Inputs record carries "no Writer Profile applied"; sections use House Rules only; the Compliance Note still lists Locked/House outcomes | INT | R-004 | `writerProfiles.test.ts` |
| PDG.3-INT-009 | CAP-8 | Missing profile → `profileState=missing`, same reporting as disabled | INT | R-004 | `writerProfiles.test.ts` |
| PDG.3-INT-010 | CAP-6 | `getProfileForGeneration` contract: callers that used `if (!profile)` still take the Build Order path (regression for the high-severity bad_spec finding of 2026-09-10) | INT | R-003 | `writerProfiles.test.ts` |

#### Story 4 — Brief panel and context visibility (CAP-3, CAP-11, CAP-17)

| ID | CAP | Scenario | Level | Risk | File |
|---|---|---|---|---|---|
| PDG.4-INT-001 | CAP-17 | Attaching 40 Supporting Documents to one project succeeds; the 41st is not refused by anything in this epic | INT | R-009 | `convex/documents.test.ts` (extend) |
| PDG.4-INT-004 | CAP-17 | The configured cap is read from `appSettings` and returned by the Brief inputs query; changing the setting changes the returned cap without code change | INT | R-009 | `convex/appSettings.test.ts` (extend) |
| PDG.4-CMP-001 | CAP-3 | Brief rail renders Inputs + four groups as Disclosures; click/Enter opens inline edit; blur saves via the `saveEntryEdit` stub with the entry id; Esc reverts without a call | CMP | — | `src/lib/components/project/BriefRail.component.test.ts` (new) |
| PDG.4-CMP-003 | CAP-3 | The only actions offered are supply-a-Storyline, edit, leave: no upload control, no "required" marker, no dialog element in the rail; generation progress continues with the rail untouched | CMP | — | `BriefRail.component.test.ts` |
| PDG.4-CMP-004 | AD-23 | A generation with no stored Brief renders the rail and the Compliance line as absent (element not in DOM) — not "empty", not a spinner, not an error | CMP | — | `BriefRail.component.test.ts` |
| PDG.4-CMP-005 | CAP-11 / CAP-17 | Inclusion rows: one row per document with its status word; header "12 of 14 documents in context · cap 12"; a `not_included` row never contains "used"; "digest" shown on a digest-sourced source-chip | CMP | R-009 | `BriefRail.component.test.ts` |
| PDG.4-CMP-006 | CAP-1 | Storyline question callout: both sides with source chips; buttons "Use the section's evidence" and "Keep the Storyline" call the resolve stub with the matching `resolvedBy`; container has `aria-live="polite"` | CMP | R-001 | `BriefRail.component.test.ts` |
| PDG.4-CMP-008 | CAP-5 | GenerationProgress: rows in Build Order; states queued → drafting → checking → shown; "Stop after this section" calls `stopOrderedGeneration` stub; no approve control rendered in `single`/`compare`; `IterativeStepper` untouched | CMP | R-003 | `src/lib/components/generation/GenerationProgress.component.test.ts` (new) |
| PDG.4-CMP-009 | CAP-7 | Compliance line: collapsed by default; `button[aria-expanded]` toggles; expanded well lists one row per instruction with a pill whose text is "applied"/"not applied" and the tier word; the no-instruction case renders the fixed sentence and is not expandable | CMP | R-004 | `src/lib/components/editor/ComplianceLine.component.test.ts` (new) |
| PDG.4-CMP-011 | CAP-8 | Inputs band shows "No Writer Profile applied — House Rules in full." when `profileState` is `disabled` or `missing`; the save-settings banner appears only when a settings document is detected and no profile matches | CMP | R-019 | `BriefRail.component.test.ts` |

#### Story 5 — One-pass convergence and Reference PD (CAP-12..CAP-15)

| ID | CAP | Scenario | Level | Risk | File |
|---|---|---|---|---|---|
| PDG.5-INT-001 | CAP-12 | Inventory tool: every paragraph of the report appears exactly once (count equals `reportSections` paragraph count); paragraphs with no `not_applied` row are listed as matching | INT | R-006 | `convex/ai/chatInventory.test.ts` (new) |
| PDG.5-INT-002 | CAP-12 | Each rule Deviation names the profile rule from its `complianceNotes` row; each writer-added content Deviation names the paragraph locator and the instruction | INT | R-006 | `chatInventory.test.ts` |
| PDG.5-UNIT-005 | CAP-13 | `superRefine` coverage: findings must cover every item id exactly once; a missing id, a duplicate id, or an unknown id rejects the tool call with a retry message | UNIT | R-006 | `convex/lib/passageEdits.test.ts` |
| PDG.5-INT-006 | CAP-13 | `blocked` rows carry `missingFact` and `missingFactSource` (interview/client); `conflicting` rows carry `lockedRule` and `alternative`; a `resolved` row carries neither | INT | R-006 | `chatProposalItems.test.ts` |
| PDG.5-HRN-008 | CAP-13 / SM-2 | Live fixture `sixteen-item-mixed-list` (14 rule + 2 content Deviations): exactly one `proposeBulkEdits` call accepted; findings 16/16; reply text lists 16 lines. Pass = 3 consecutive nightly runs | HRN | R-006, R-014 | `scripts/chat-behavior-eval.mjs` |
| PDG.5-HRN-009 | CAP-14 | Live fixture `help-you-converge`: reply is a Proposal or a list of missing facts; fails if the reply asks for a Storyline, Claim Exclusions, Confidence Map, Glossary Terms, or any document from the writer (regex guard on the reply) | HRN | R-017 | `scripts/chat-behavior-eval.mjs` |
| PDG.5-INT-010 | CAP-14 | Missing-facts source: the questions are built from `generationBriefEntries` of group `confidenceMap` with confidence `unresolved`/`unreliable`; an `established` entry never becomes a question | INT | R-017 | `chatInventory.test.ts` |
| PDG.5-INT-012 | CAP-15 | Reference PD comparison tool output: inventory shape with group `reference`, rows name paragraphs; no numeric score field in the primary output | INT | — | `chatInventory.test.ts` |
| PDG.5-INT-013 | CAP-15 | A Reference PD difference that would exceed a Locked Rule cap is emitted as `conflicting` with the rule named, never as an edit | INT | R-004 | `chatProposalItems.test.ts` |
| PDG.5-CMP-012 | CAP-13 | ProposedEditCard renders N completion rows above the diff; pill text "resolved"/"blocked"/"conflicting" present; blocked names the fact; existing actions (Replace, Review one by one, Reject, Edit wording, Show in doc) unchanged; no auto-apply | CMP | R-006 | `src/lib/components/chat/ProposedEditCard.component.test.ts` (new or extend) |

#### Story 6 — Paired Comparison records (CAP-16)

| ID | CAP | Scenario | Level | Risk | File |
|---|---|---|---|---|---|
| PDG.6-INT-001 | CAP-16 | Record shape: all fields from AD-29 required (project, report revision, `contentHash`, generation, `banhallModel`, `baselineProduct`, `baselineModel`, `modelCaveat`, judge, `preference`, both Deviation counts, `countingMethod`, both Corrections, `usedInDevelopment`, `recordedAt`); a record missing any is rejected by the validator | INT | R-008 | `comparisons.test.ts` |
| PDG.6-INT-002 | CAP-16 | Non-admin `record` refused (`NOT_AUTHORIZED`) until Q18 decides the capability cell | INT | R-015 | `comparisons.test.ts` |
| PDG.6-UNIT-005 | SM-1 | SM-1 arithmetic: ≥4 non-development projects, ≥3 preferred, Banhall Deviations ≤ half of baseline on each counted project → win; each boundary (3 of 4, exactly half) asserted | UNIT | R-008 | `convex/lib/comparisonMetrics.test.ts` (new pure module) |
| PDG.6-UNIT-006 | SM-2 | SM-2: Corrections-to-acceptable ≤ 1 on ≥3 of 4 → pass; boundary asserted | UNIT | R-008 | `comparisonMetrics.test.ts` |
| PDG.6-INT-009 | Q15 | `modelCaveat` must be non-empty; the record stores product and model versions verbatim | INT | R-020 | `comparisons.test.ts` |

**Total P1**: 62 tests

### P2 (Medium)

**Criteria**: secondary behaviour with narrower reach and an acceptable workaround.

| ID | CAP | Scenario | Level | File |
|---|---|---|---|---|
| PDG.1-INT-008 | CAP-2 | Digest-sourced Confidence Map entries marked; a full-text entry is not | INT | `brief.test.ts` |
| PDG.1-INT-010 | CAP-2 | Model classification invoked only for candidates the rule matcher flags (provider spy: zero calls on a fixture with no flagged candidates) | INT | `brief.test.ts` |
| PDG.1-HRN-011 | CAP-2 | Adversarial paraphrase corpus (prominent excluded claims, reworded): ≥95% absent from the draft; every remainder flagged by the Self-check; residual reported in the scorecard | HRN | `scripts/chat-behavior-eval.mjs` (new generation fixture) or a dedicated `scripts/generation-eval.mjs` (assumption A-7) |
| PDG.1-INT-016 | CAP-3 | Edit against a stale version → `domainError("BRIEF_STALE")`; no row inserted | INT | `brief.test.ts` |
| PDG.1-UNIT-018 | CAP-4 | `briefInputsHash` excludes `writer_storyline` and `transcript_digest`; order-independent; changes when any other source's `contentHash` changes | UNIT | `briefInputsHash.test.ts` (existing — verify it is real) |
| PDG.1-AUDIT-019 | AD-23 | `db.insert("generationBriefs"` and `db.insert("generationBriefEntries"` appear only in `convex/ai/brief.ts`, `convex/briefs.ts`, and the section chain (for `storylineQuestion`) | AUDIT | `src/lib/components/ui/formControlContract.test.ts` sibling audit |
| PDG.2-INT-007 | CAP-5 | "Generate the rest" creates a new generation with `resumesGenerationId` and the drafted sections as prior context; written by `createGeneratedReportArtifacts`, not an AD-3 revision writer | INT | `promptProgram.test.ts` |
| PDG.2-INT-017 | CAP-9 | Consistency pass flags a cross-section contradiction (242 states X, 246 contradicts) with section references and passages; does not auto-repair | INT | `convex/ai/postQa` tests |
| PDG.2-AUDIT-024 | AD-25 | No unit other than the section chain inserts `complianceNotes`; the chain's only other write is the `storylineQuestion` entry | AUDIT | source audit |
| PDG.2-INT-032 | SM-C2 | A full single-mode generation with no repairs produces ≤ 11 `aiUsage` rows (1 brief + 3×2 + 1 consistency + existing qa/compression slots as today), all labelled | INT | `instrument.test.ts` |
| PDG.2-INT-045 | CAP-10 | No paragraph exceeds the profile's density rule where one exists; a breach is a `not_applied` row with `paragraphIndex` | INT | `selfCheck.test.ts` |
| PDG.3-INT-004 | CAP-6 | Org Mode `off`: the category is dropped and reported (`effective=false`, reason), never silent | INT | `writerProfiles.test.ts` |
| PDG.3-AUDIT-005 | AD-26 | `tier` is computed only in `getEffectiveWriterStyle`; `resolveEffectiveOverrides` returns modes only; generation and chat call sites consume the style result and nothing else | AUDIT | source audit |
| PDG.3-MAN-006 | CAP-6 | `docs/product-domain.md` carries one dated amendment naming the four tiers, "no silent tier", and the effort ceiling | MAN (doc check, greppable) | — |
| PDG.3-INT-011 | CAP-8 | A settings document detected in Writer's Notes or an attachment sets the "offer to save to profile" flag on the Brief inputs; no automatic profile write | INT | `writerProfiles.test.ts` |
| PDG.4-CMP-002 | CAP-3 | Origin chip reads *derived* by default, *writer* when supplied, *edited* after a save | CMP | `BriefRail.component.test.ts` |
| PDG.4-CMP-007 | CAP-4 | Group headers show "N added · N removed" read from `change` stamps; "Regenerate with this Brief" is hidden when the re-derivation already ran | CMP | `BriefRail.component.test.ts` |
| PDG.4-CMP-011b | CAP-3 | Editing a Claim Exclusion's text keeps its reason chip | CMP | `BriefRail.component.test.ts` |
| PDG.4-CMP-013 | CAP-12 | Inventory checklist: unchecking a row removes it from the action; "Bring all N into alignment" counts checked rows; zero Deviations renders "Nothing deviates from your settings." | CMP | `ProposedEditCard.component.test.ts` / new `InventoryChecklist.component.test.ts` |
| PDG.5-INT-003 | CAP-12 | Rule and content Deviations are passed to the revision tool with the same item shape; content items are never deferred to a follow-up turn | INT | `chatProposalItems.test.ts` |
| PDG.5-INT-011 | CAP-14 | Zero unresolved entries → the reply is a Proposal, never an empty list | INT | `chatInventory.test.ts` |
| PDG.5-INT-014 | CAP-15 | `projectDocuments.isReferencePd`: at most one true per project; marking a second unmarks the first | INT | `convex/documents.test.ts` |
| PDG.5-HRN-016 | Regression | The seven existing harness fixtures still pass (extraction, injection, brain opt-in) | HRN | `scripts/chat-behavior-eval.mjs` |
| PDG.6-INT-003 | CAP-16 | `draftTextMatches` computed at record time from the pinned revision's plain text against `banhallDraftText` | INT | `comparisons.test.ts` |
| PDG.6-INT-007 | CAP-16 | No update mutation exists for a comparison; correction is a new row with `voidsComparisonId` | INT + AUDIT | `comparisons.test.ts` |
| PDG.6-AUDIT-008 | CAP-16 | `convex/comparisons.ts` imports no reader of `chatProposalItems` or `complianceNotes`; Deviation counts are arguments, never derived | AUDIT | source audit |
| PDG.4-CMP-010 | Design system | New components use bits-ui primitives and no font weight above 500 (extend the existing `formControlContract` source audit to the new component directories) | AUDIT | `formControlContract.test.ts` |

**Total P2**: 27 tests

### P3 (Low)

| ID | CAP | Scenario | Level | File |
|---|---|---|---|---|
| PDG.5-INT-015 | CAP-13 | N > 30 items: the tool refuses with a reason naming the bound (assumption A-8: reject, not split) | INT | `passageEdits.test.ts` |
| PDG.2-INT-046 | SM-C1 | Word counts per section recorded on the scorecard so length drift is observable across HRN runs | INT | `instrument.test.ts` |
| PDG.4-CMP-014 | A11y | Source popover traps focus and returns it to the chip on Esc | CMP | `BriefRail.component.test.ts` |
| PDG.6-CMP-015 | CAP-16 | `/admin/comparisons` form: required fields enforced inline; development flag defaults off; table newest first; SM lines read "—" when empty | CMP | `src/lib/components/admin/ComparisonsForm.component.test.ts` (new) |

**Total P3**: 4 tests

### Manual protocol steps — Paired Comparison (CAP-16, SM-1, SM-2; `measurement-protocol.md`)

These are human steps, never automated. Each has a recorded artefact so the run is auditable.

| Step | What | Who | Artefact / check |
|---|---|---|---|
| MP-01 | Select the project set: 25001 (development, reported separately) + ≥4 non-development projects, ≥2 untouched during Brief/Self-check development, ≥1 of 100–200 hours; Reference PDs from Larry or Tracy | Michael, Johnny | List with hours and "touched during development" flag |
| MP-02 | For each project, assemble the identical Dump: same files, same settings text, same Writer's Notes | Writer | File manifest with sha256 per file |
| MP-03 | Produce the ChatGPT baseline in a fresh ChatGPT project (Sol) with the same files; record product and model version and the Q15 caveat | Writer | Baseline text + version note |
| MP-04 | Generate in Banhall (Sol) in the writer's usual mode (`single`/`compare`, Open Question 2); note `generationId` | Writer | `generationId` |
| MP-05 | A third person (not the judge) strips both drafts to identically formatted plain text: no Compliance Notes, no Brief, no glossary callouts, no tool headings; labels A/B with order randomised per project; keeps the key sealed | Third person | Two `.txt` files + sealed key |
| MP-06 | Judge reads both blind and records preference (A/B/tie) | Larry (Michael second where available) | Preference sheet |
| MP-07 | Judge counts Deviations against their settings by the same manual method for both drafts; the Deviation Inventory tool is not used for either | Judge | Two counts + the method written down once |
| MP-08 | Judge records Corrections-to-acceptable for both drafts (revision rounds until "acceptable"); for Banhall this is the number of Coordinated Revisions | Judge | Two counts |
| MP-09 | Unseal the key; record the row through `/admin/comparisons` (or the script) with every field of AD-29, `usedInDevelopment` true only for 25001 | Admin | `comparisons` row; PDG.6-INT-001 shape |
| MP-10 | Compute SM-1 and SM-2 excluding development and voided rows; report 25001 separately | Admin | SM lines on the admin page |
| MP-11 | Dry-run MP-02..MP-10 once on 25001 before the judging week to shake out the protocol | Johnny | Dry-run note |
| MP-12 | Weekly self-report through September for SM-3 (no offline Storyline/Exclusions/Confidence Map/Glossary) and SM-5 (ChatGPT drafting count) | Larry, Tracy | Two short weekly entries |

---

## Execution Strategy

**Philosophy:** run everything in PRs if it finishes in under 15 minutes; defer only what is expensive, billable, or needs a human.

| Cadence | What runs | How |
|---|---|---|
| **Every PR** | All UNIT, INT and AUDIT tests (every P0–P3 automated row except CMP/HRN) | `bash scripts/loop-verify.sh` (preflight, Convex typecheck, `npm run check`, `npm test`, discovery guard, build, uploader harnesses). The `convex` project already carries a 30 s per-test budget for convex-test module-graph cost. |
| **Every PR (second CI job)** | All CMP tests | `npm run test:component` with Chromium installed; run locally before touching `src/lib/components`. Fresh optimizer cache after dependency changes. |
| **Nightly / pre-release** | HRN fixtures (PDG.5-HRN-008/009/016, PDG.1-HRN-011) | `node scripts/chat-behavior-eval.mjs --out .audit/chat-behavior` with `ANTHROPIC_API_KEY`; archive results; a release requires three consecutive green nights for the 16-item fixture |
| **Once, before story 2 merges** | SM-C2 baseline measurement | Count `aiUsage` rows and wall time for one single-mode run on the dev deployment; record in `.audit/` |
| **After 2026-09-15** | MP-01..MP-12 | Human protocol; MP-11 dry-run first |

No tests are re-listed here; see the coverage plan.

---

## Resource Estimates

Intervals only; these include fixture authoring and the provider-stub plumbing the INT tests share.

| Priority | Count | Effort (range) | Notes |
|---|---|---|---|
| P0 | 16 | ~20–30 hours | Contradiction fixture, chain/gate harness, stubbed model returning tool calls |
| P1 | 62 | ~45–75 hours | Most are AD-named enforcing tests written alongside the code |
| P2 | 27 | ~10–20 hours | Mostly short INT cases on existing fixtures |
| P3 | 4 | ~2–5 hours | |
| Manual protocol | 12 steps | ~1–2 days per project for the writer, ~1 day set-up | Outside engineering hours |
| **Total (automated)** | **109** | **~80–130 hours (~2–3.5 weeks, one engineer, parallel to implementation)** | |

### Prerequisites

**Test data / fixtures** (assumption A-6: under `convex/ai/__fixtures__/pd-generation/`):

- `contradiction.transcript.txt` — one derived Storyline claim contradicted by a stronger passage
- `three-transcripts/` — three interviews disagreeing on one fact
- `adversarial-exclusions/` — prominent excluded claims, paraphrased
- `glossary-synonyms.json` — known synonym pairs (≥ 40 pairs so 95% is measurable)
- `unreliable-fact.transcript.txt` — a fact the Confidence Map marks unreliable
- `settings-document.txt` — Larry-style customized settings (same text used for profile / Writer's Notes / attachment)
- `sixteen-item-list.json` — 14 rule + 2 content Deviations (also the live-harness fixture)
- Provider stub: a `generateStructured` fake that returns canned tool calls / structured outputs per slot label, so INT tests never hit a model

**Tooling:** vitest 4.1 (`convex`, `shared`, `src`, `source-audit` projects); `convex-test`; `vitest-browser-svelte` + Chromium; `scripts/chat-behavior-eval.mjs`.

**Environment:** none for PR tests (preflight defaults public placeholders); `ANTHROPIC_API_KEY` for HRN; the dev deployment `energized-salamander-237` for the SM-C2 baseline and the MP dry-run.

---

## Quality Gate Criteria

### Pass/Fail Thresholds

- **P0 pass rate**: 100%, no exceptions (R-001 and R-006 cannot be waived)
- **P1 pass rate**: ≥95%; every failure triaged with an owner before merge
- **P2/P3 pass rate**: ≥90% (informational)
- **HRN**: 16-item fixture 16/16 on three consecutive runs; "converge" guard 3/3; existing seven fixtures green
- **High-risk mitigations**: 100% complete or approved waivers (none allowed for score-9 items)

### Coverage Targets

- Every CAP-1..CAP-17 success clause mapped to at least one test row above (traceability: run `bmad-testarch-trace` after implementation)
- SM-1, SM-2 arithmetic and exclusions: 100% (P0/P1)
- Security scenarios (authorization branches on new mutations): 100%
- Critical paths (Brief derive/reuse, ordered chain, Self-check, Completion Report): ≥80% of scenarios automated at INT or UNIT

### Non-Negotiable Requirements

- [ ] All P0 tests pass in `loop-verify.sh` and `test:component`
- [ ] No score-≥6 risk unmitigated
- [ ] No `test.skip`, `it.only`, or assertion-free test in the epic's files (gate enforces)
- [ ] `applyProposal` untouched; no code path lets a tool mutate prose (PDG.5-INT-007)
- [ ] Locked Rule constants unchanged (PDG.2-INT-012)
- [ ] NFR evidence identified for each category above; PASS/CONCERNS/FAIL deferred to `nfr-assess`

---

## Mitigation Plans

### R-001: Storyline contradiction repaired away instead of raised (Score: 9)

**Mitigation Strategy:** (1) Author the contradiction fixture first and make PDG.1-INT-003 fail against the current `selfCheck.ts` (which today has no Storyline back-check). (2) Implement the comparison of section-evidence confidence vs. Storyline-basis confidence; only `established` vs `partial|unresolved` raises a question. (3) The section chain's `storylineQuestion` insert is the only write outside `complianceNotes` (PDG.2-AUDIT-024). (4) PDG.1-INT-004 proves the inverse (weaker evidence → ordinary repair). (5) PDG.4-CMP-006 proves the question reaches the writer with both sides.
**Owner:** Dev (stories 1–2) · **Timeline:** before story 2 review · **Status:** Planned · **Verification:** PDG.1-INT-003/004/017, PDG.4-CMP-006 green.

### R-006: Completion Report drops items (Score: 9)

**Mitigation Strategy:** (1) Re-run Larry's Rev G 16-item list against the PR #8 bulk-edit tool and record what already passes (Open Question 7). (2) Full-coverage `superRefine` on findings (PDG.5-UNIT-005). (3) Persist findings as `chatProposalItems` rows and echo every item in the reply from the rows, not from the model's prose (PDG.5-INT-004/006). (4) Live fixture nightly with a three-run burn-in (PDG.5-HRN-008). (5) CMP proves the rows render (PDG.5-CMP-012).
**Owner:** Dev (story 5) · **Timeline:** before story 5 review · **Status:** Planned · **Verification:** PDG.5-INT-004 green in PR; HRN 3/3.

### R-002: Brief citations not byte-matched (Score: 6)

**Mitigation Strategy:** Extract the `createProvenance` byte-match into `convex/lib/citations.ts` (keeping `createProvenance` behaviour identical, proven by existing `reports.test.ts`) and reuse it; PDG.1-INT-006 injects a wrong offset and a wrong hash separately.
**Owner:** Dev (story 1) · **Timeline:** story 1 · **Status:** Planned · **Verification:** PDG.1-INT-006, existing `reports.test.ts` unchanged and green.

### R-003: Gate regressions and one-action chain (Score: 6)

**Mitigation Strategy:** Three P0 tests (PDG.2-INT-001/004/005) plus the scheduler-count test; `iterative` tests stay as they are and must not be edited in story 2's PR (review rule).
**Owner:** Dev (story 2) · **Timeline:** story 2 · **Status:** Planned · **Verification:** the four tests green; `git diff` of story 2 touches no iterative test expectation.

### R-004: Silent override (Score: 6)

**Mitigation Strategy:** N-in/N-out (PDG.2-INT-020), unfollowable instruction (PDG.2-INT-021), six-category matrix (PDG.3-INT-001/002), tier copied not recomputed (PDG.2-INT-023), CMP renders every row (PDG.4-CMP-009).
**Owner:** Dev (stories 2–3) · **Timeline:** story 3 · **Status:** Planned · **Verification:** SM-4 has no "silently overridden" writer report in September.

### R-008: SM computed from the wrong rows (Score: 6)

**Mitigation Strategy:** Pure metrics module with boundary tests (PDG.6-UNIT-005/006); exclusion INT test (PDG.6-INT-004); import audit (PDG.6-AUDIT-008).
**Owner:** Dev (story 6) · **Timeline:** story 6 · **Status:** Planned · **Verification:** tests green; MP-10 dry-run matches a hand computation.

### R-012: Unhedged unreliable fact (Score: 6)

**Mitigation Strategy:** Hedging fixture with a deterministic pre-check (flat assertion of a fact whose Confidence Map entry is `unresolved|unreliable`) before any model judgment; PDG.2-INT-013.
**Owner:** Dev (story 2) · **Timeline:** story 2 · **Status:** Planned · **Verification:** PDG.2-INT-013 green; SM-C3 fabrication flags do not rise.

### R-014: Non-deterministic live harness (Score: 6)

**Mitigation Strategy:** Deterministic INT/UNIT tests carry the PR gate; HRN is nightly with archived results and a three-run burn-in before release; failures open a finding, never block a PR.
**Owner:** QA/Dev · **Timeline:** from story 5 · **Status:** Planned · **Verification:** `.audit/chat-behavior/` history.

### R-016: Vacuous tests (Score: 6)

**Mitigation Strategy:** Gate already refuses skipped/vacuous tests (fd9dcfc). Story 1's `brief.test.ts` stubs are replaced by PDG.1-INT-001..017; `glossaryMatcher.test.ts` and `briefInputsHash.test.ts` are reviewed for the same pattern.
**Owner:** Dev (story 1) · **Timeline:** story 1 · **Status:** In progress · **Verification:** discovery guard green; no `expect(true)` in epic files.

### R-018: Compliance Notes as a string field (Score: 6)

**Mitigation Strategy:** PDG.2-INT-022 asserts the table and its two indexes; story 2's `invoke_dev_with` already mandates the correction; the widen/narrow of the string field follows AD-10.
**Owner:** Dev (story 2) · **Timeline:** story 2 · **Status:** Planned · **Verification:** PDG.2-INT-022 and PDG.2-INT-016 (`paragraphIndex`) green.

### R-011: Brief reuse keyed wrongly (Score: 6)

**Mitigation Strategy:** PDG.1-UNIT-018 (hash exclusions), PDG.1-INT-002 (Storyline does not change the hash), PDG.1-INT-015 (MAX(version)), PDG.1-INT-016 (`BRIEF_STALE`).
**Owner:** Dev (story 1) · **Timeline:** story 1 · **Status:** Planned · **Verification:** tests green.

---

## Assumptions and Dependencies

### Assumptions (choices made because no human was available)

1. **A-1 — Run identity.** The epic carries no number; `epic_num` is the slug `pd-generation` (from the SPEC id `SPEC-pd-generation`), so the plan is `test-design-epic-pd-generation.md` and the checkpoint `test-design-progress-epic-pd-generation.md`.
2. **A-2 — Stories 3–6 have no markdown yet.** Their scenarios are grounded in `stories.yaml` descriptions and the SPEC CAP success clauses; when their story files land, the IDs here should be cross-checked, not re-derived.
3. **A-3 — Test levels.** The repo has no Playwright E2E project; "E2E" in the template is mapped to CMP (browser component) for UI behaviour and to INT (convex-test) for pipeline behaviour with providers stubbed. `tea_use_playwright_utils=true` therefore has nothing to bind to and no code examples are emitted; `tea_use_pactjs_utils` is irrelevant (no contract surface). Pact MCP was not probed.
4. **A-4 — No browser exploration.** Unattended, no deployment reachable; the UX spine (`EXPERIENCE.md`) stands in for a snapshot.
5. **A-5 — Output location.** Plan written under the configured `test_design_output` (`_bmad-output/test-artifacts/test-design/`); the progress checkpoint under `test_artifacts` root as the skill prescribes. Nothing else was written or modified.
6. **A-6 — Fixture location.** `convex/ai/__fixtures__/pd-generation/` (a directory not matched by any vitest `include`); the dev session may choose another path as long as fixtures are checked in.
7. **A-7 — Adversarial-exclusion fixture (CAP-2, ≥95%).** Requires a live model on the generation path; placed at HRN, P2, either as a new fixture in `chat-behavior-eval.mjs` or a sibling `generation-eval.mjs`. It is not a PR gate.
8. **A-8 — N > 30 items.** The SPEC bounds the Completion Report at N ≤ 30 inside the tool's 40/80 caps; assumed behaviour above 30 is a refusal naming the bound, not a split.
9. **A-9 — HRN "every run".** Interpreted as three consecutive green nightly runs before a release; PR gates use deterministic tests only.
10. **A-10 — Baseline for 2x.** "Today's single-mode run" is measured once on the dev deployment before story 2 merges; until then SM-C2 tests assert slot counts and the `overrun` flag, not seconds or dollars.
11. **A-11 — Locked Rules stay locked** including s246 caps (SPEC assumption); Open Question 1 does not change any test here.
12. **A-12 — `comparisons` writes are admin-only** until Q18; the CMP test for the admin form is P3 because the record can also be entered by script.

### Dependencies

1. **D-1** Story markdown for stories 3–6 — before those stories are built.
2. **D-2** `npx convex codegen` refresh on a deployment — before story 1's INT tests can typecheck in CI (story 1 defers this).
3. **D-3** SM-C2 baseline measurement — before story 2 merges.
4. **D-4** Q17 (retention/framing of Claim Exclusions) — before the provenance NFR ships; no test depends on it.
5. **D-5** Q15 model-equivalence decision or a standing caveat string — before MP-09.
6. **D-6** Larry's settings document (Open Question 1) — before 2026-09-12; feeds the `settings-document.txt` fixture.
7. **D-7** Larry's availability — judging from the week of 2026-09-22.

### Risks to Plan

- **Risk:** stories 3–6 diverge from the SPEC clauses this plan used.
  - **Impact:** test IDs point at behaviour that moved.
  - **Contingency:** `bmad-testarch-test-design` edit mode on this file; IDs are stable, rows are edited in place.
- **Risk:** the live harness is flaky enough that three consecutive greens are rare.
  - **Impact:** release gate stalls on HRN.
  - **Contingency:** tighten the deterministic coverage (findings validator, rows echo) and treat HRN as informational with a human read of the archived replies.
- **Risk:** the partial implementation on the branch (string `complianceNotes`, single-action chain) is completed as-is.
  - **Impact:** PDG.2-INT-022 and PDG.2-INT-010b fail by design.
  - **Contingency:** that is the intent; the story's `invoke_dev_with` already mandates the correction.

---

## Follow-on Workflows (Manual)

- Run `/bmad-testarch-atdd` to generate the failing P0 tests (start with PDG.1-INT-003, PDG.2-INT-001/004/005, PDG.5-INT-004).
- Run `/bmad-testarch-automate` once stories land for P1/P2 breadth.
- Run `/bmad-testarch-trace` after implementation for the CAP → test matrix and the gate decision.
- Run `/bmad-testarch-nfr` when `aiUsage` evidence for SM-C2 exists.

---

## Approval

**Test Design Approved By:**

- [ ] Product direction: Michael  Date: ____
- [ ] Tech Lead / Owner: Johnny  Date: ____
- [ ] QA: ____  Date: ____

**Comments:** Unattended draft; review the *Assumptions* list first.

---

## Interworking & Regression

| Service/Component | Impact | Regression Scope (existing tests that must stay green) |
|---|---|---|
| **Generation pipeline** (`convex/ai/pipeline.ts`, `iterative.ts`, `promptProgram.ts`) | New `brief` stage; ordered chain in `single`/`compare` | `pipeline.compare.test.ts`, `sectionAgents.test.ts`, `promptScaffolds.test.ts`, `prompts.test.ts`, `generationLifecycle.test.ts`, `generationRecovery.test.ts`, `generationReaper.test.ts`, `generationEntryFailure.test.ts`, `qaBlocking.test.ts` |
| **Provenance** (`convex/reports.ts` `createProvenance`) | Byte-match rule reused | `reports.test.ts`, `reportAuthz.test.ts` |
| **Writer profiles / house style** | Four-tier outcome, `profileState`, `buildOrder` | `writerProfiles.test.ts`, `houseStyle.test.ts`, `shared/styleOverrides.test.ts`, `styleAnalysis.test.ts` |
| **Trusted context / documents** | Per-row `inclusion`; 40 attachments | `trustedContext.test.ts`, `documents.test.ts`, `condenseAgent.test.ts`, `transcriptDigests.test.ts`, `contextBoundary.test.ts` |
| **Chat** (`chatAgentV2.ts`, `chatV2.ts`, `passageEdits.ts`) | Inventory tool, Completion Report rows, Reference PD tool, "make it better" guard | `chatProposals.test.ts`, `chatTurns.test.ts`, `chatContext*.test.ts`, `chatEvidence*.test.ts`, `passageEdits.test.ts`, `chatPublicOutput.test.ts`, `tests/chatProposals.test.ts`, the seven HRN fixtures |
| **Instrumentation** (`instrument.ts`, `aiUsage`) | Slot enum | `instrument.test.ts`, `tests/aiUsage.test.ts`, `providers.test.ts` |
| **Report editor / export** | Compliance line; parity | `tiptapReport.test.ts`, `exportValidation.test.ts`, `reportEditDistance.test.ts` |
| **Brain** | Must not see Brief rows | `brainErase.test.ts`, `brainFeedback.test.ts`, `brainUnlearn.test.ts`, `learning*.test.ts` |
| **Workspace shell / rail** | Third `railView` | `workspaceRoutes.component.test.ts`, `WorkspaceGate.component.test.ts`, `WorkspaceChromePointer.component.test.ts` |
| **Untouched by contract** | `convex/http.ts`, `ingestionClassify.ts`, uploader kit, role capabilities, `convex/_generated/` | `ingestion*.test.ts`, `roleCapabilities.test.ts`, `projectAccess.test.ts`, uploader harnesses in `loop-verify.sh` |

---

## Appendix

### Knowledge Base References

- `risk-governance.md` — scoring, ≥6 mitigation, 9 blocks
- `probability-impact.md` — P/I scale definitions used above
- `test-levels-framework.md` — level selection and duplicate-coverage guard
- `test-priorities-matrix.md` — P0–P3 criteria
- `nfr-criteria.md` — NFR categories for the planning table
- `evidence-integrity.md` — "hollow green" rule behind R-016

### Related Documents

- SPEC: `_bmad-output/specs/spec-pd-generation/SPEC.md` (+ `glossary.md`, `touchpoints.md`, `measurement-protocol.md`, `user-journeys.md`, `stories.yaml`, `stories/1-*.md`, `stories/2-*.md`)
- PRD: `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-09/prd.md`
- Architecture: `_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md` (AD-23..AD-30, Q15..Q17)
- UX: `_bmad-output/planning-artifacts/ux-designs/ux-Banhall-2026-09-09/DESIGN.md`, `EXPERIENCE.md`
- Domain contract: `docs/product-domain.md`; Convex rules: `convex/_generated/ai/guidelines.md`
- Gate: `scripts/loop-verify.sh`, `scripts/check-test-discovery.mjs`; live harness: `scripts/chat-behavior-eval.mjs`

### CAP → test index (quick traceability)

| CAP | P0 | P1 | P2/P3 | Manual |
|---|---|---|---|---|
| CAP-1 | 1-INT-003 | 1-INT-001/002/004/005/017, 4-CMP-006 | — | — |
| CAP-2 | 1-INT-006 | 1-INT-007, 1-UNIT-009 | 1-INT-008/010, 1-HRN-011 | — |
| CAP-3 | — | 1-INT-014/015, 4-CMP-001/003 | 1-INT-016, 4-CMP-002/011b | — |
| CAP-4 | 1-INT-012 | 1-INT-013 | 1-UNIT-018, 4-CMP-007 | — |
| CAP-5 | 2-INT-001/004/005 | 2-INT-002/003/006/008/009/010b, 4-CMP-008 | 2-INT-007 | — |
| CAP-6 | 3-INT-001/002 | 3-INT-003/010 | 3-INT-004, 3-AUDIT-005, 3-MAN-006 | doc check |
| CAP-7 | 2-INT-020 | 2-INT-021/022/023, 4-CMP-009 | 2-AUDIT-024 | — |
| CAP-8 | — | 3-INT-007/008/009, 4-CMP-011 | 3-INT-011 | — |
| CAP-9 | 2-INT-010/013/014 | 2-INT-011/012/015/016 | 2-INT-017/045 | — |
| CAP-10 | — | 2-UNIT-040 | 2-INT-045 | — |
| CAP-11 | 4-INT-002 | 2-INT-041, 4-CMP-005 | — | — |
| CAP-12 | — | 5-INT-001/002 | 5-INT-003, 4-CMP-013 | — |
| CAP-13 | 5-INT-004/007 | 5-UNIT-005, 5-INT-006, 5-HRN-008, 5-CMP-012 | 5-INT-015 | — |
| CAP-14 | — | 5-HRN-009, 5-INT-010 | 5-INT-011 | — |
| CAP-15 | — | 5-INT-012/013 | 5-INT-014 | — |
| CAP-16 | 6-INT-004 | 6-INT-001/002/009, 6-UNIT-005/006 | 6-INT-003/007, 6-AUDIT-008, 6-CMP-015 | MP-01..MP-12 |
| CAP-17 | 4-INT-002 | 4-INT-001/004, 2-INT-042, 4-CMP-005 | — | — |
| SM-C2 | 2-INT-014 | 2-UNIT-030, 2-INT-031 | 2-INT-032 | baseline (D-3) |

---

**Generated by**: BMad TEA Agent — Test Architect Module (unattended)
**Workflow**: `bmad-testarch-test-design`
**Version**: 4.0 (BMad v6)
