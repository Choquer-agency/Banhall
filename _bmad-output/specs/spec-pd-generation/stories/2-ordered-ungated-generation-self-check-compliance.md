---
title: 'Ordered, ungated generation with Self-check and Compliance Notes'
type: 'feature'
created: '2026-09-10'
status: 'in-progress'
baseline_revision: 'fefeb82b0fed01f5c130e449cee57badc9b44254'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - convex/_generated/ai/guidelines.md
  - _bmad-output/specs/spec-pd-generation/SPEC.md
  - _bmad-output/specs/spec-pd-generation/touchpoints.md
  - _bmad-output/specs/spec-pd-generation/glossary.md
  - _bmad-output/specs/spec-pd-generation/user-journeys.md
  - _bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md
  - docs/product-domain.md
warnings: []
deferred:
  - summary: >-
      Phases 3-6 (pipeline orchestration, consistency pass, prompts, comprehensive tests) deferred to next implementation cycle. Phases 1-2 complete (schema, profiles, selfCheck types, compliance note structures).
    evidence: |-
      Implementation agent completed phases 1-2:
      - convex/schema.ts: complianceNotes field added ✓
      - convex/writerProfiles.ts: buildOrder support + tier tracking ✓
      - convex/ai/selfCheck.ts: self-check module with types ✓
      - convex/lib/complianceNote.ts: compliance record structures ✓
      - convex/ai/promptProgram.ts: ordered topology documented ✓
      
      Remaining work (phases 3-6):
      - Pipeline.ts: ordered section generation loop, prior-context injection
      - PostQa.ts: consistency pass detection
      - Prompts.ts: self-check + prior-context templates
      - Tests: selfCheck.test.ts, pipeline.test.ts (ordering), coverage for all matrix rows
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Currently all three sections (242, 244, 246) are drafted in parallel via a candidate pipeline. The section generation lacks ordered sequencing with prior-section context, per-section self-checks before output, and traceable compliance reporting. Writers have no visibility into which profile instructions were applied or rejected per section, making it impossible to audit the generation.

**Approach:** Add ordered, ungated section generation to `single` and `compare` modes (default 242 → 244 → 246) with each section's prior-section context available to the prompt, each section run through a self-check before display, and stored Compliance Notes recording which profile instructions were applied and why others were not applied. The existing `iterative` mode's gated behavior remains unchanged. Story 1's Brief infrastructure (Storyline, Claim Exclusions, Confidence Map, Glossary Terms) provides the semantic foundation; this story wires the self-check rubric (CAP-9) and consistency pass (CAP-10) to validate output before the writer sees it.

## Boundaries & Constraints

**Always:**
- Ordered section generation in `single` and `compare`: default Build Order is 242 → 244 → 246; writers can customize via profile
- Prior-section context is passed to each section generation call (section 244 receives drafted 242; section 246 receives 242 + 244)
- Every section's self-check runs before output and produces a structured outcome (pass | repair attempted | repair failed)
- Repair attempts are recorded per-section and capped at one per section; if repair fails, the section is shown with a notice
- One assembled-draft consistency pass runs after all sections are drafted and before the last section is shown to the writer
- Compliance Note is stored with the generation and records per-section: which profile instructions were applied, which were not, and why (reason codes: cap breach, cap met, instruction applied, instruction waived via override, disabled profile, missing profile)
- Call budget: per section one generation + one self-check + at most one repair; consistency pass runs once; total end-to-end within 2x today's single-mode
- Writer Profile Build Order must support custom ordering and per-paragraph self-check rules; if a rule exceeds its cap it is applied up to the cap and reported
- The iterative mode's gated behavior (section-by-section human approval gates) is unchanged
- All compliance and self-check outcomes are stored alongside the generation record for audit and reporting

**Block If:**
- Build Order cannot be derived from the writer profile (profile missing, disabled, or malformed): report to writer as `no effective writer profile` and use House Rules default (242 → 244 → 246)
- A self-check repair fails (after one attempt): the section is shown with a `Self-check repair failed` flag and the repair outcome in the Compliance Note
- Consistency pass detects incompatible changes between sections (e.g., a claim excluded in Brief appears in the section): flag the section and record the issue in Compliance Note
- Writer Profile Build Order specifies a section not in {242, 244, 246}: HALT with `invalid section in Build Order`

**Never:**
- Let unrepaired failed checks block generation; show the section with the outcome recorded
- Mutate report prose directly from self-check; route repairs through the same generation mechanism as the initial draft
- Silently apply a House Rule when a writer override is present; record every decision in Compliance Note
- Gate generation in `single` or `compare` modes; ungated means all sections are shown to the writer as they complete
- Store repair attempts inline; every repair call is a separate model interaction with its own aiUsage entry
- Require the writer to author a new artifact; the Dump is the maximum required input
- Change Locked Rules (242/244/246 skeleton, line and word caps)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal ordered flow, single mode | Project with Brief + Writer Profile | Sections generated in order (242 → 244 → 246); each section passes self-check; consistency pass runs; all three shown to writer | No error expected |
| Enabled Writer Profile with custom Build Order | Project + Profile with custom order (e.g., 246 → 242 → 244) | Sections generated in custom order; prior-section context passed correctly | Invalid order in profile → use default 242 → 244 → 246 |
| Disabled Writer Profile | Project + disabled profile | Sections generated in House Rules default (242 → 244 → 246); Compliance Note reports "no Writer Profile applied" | No error expected |
| Missing Writer Profile | Project + no profile for user | Sections generated in House Rules default; Compliance Note reports "no Writer Profile applied" | No error expected |
| Self-check detects excluded claim | Section 244 draft contains claim from Brief's Claim Exclusions | Self-check repair attempted; repair removes or hedges the claim; outcome recorded in Compliance Note | Repair fails → section shown with flag, outcome recorded |
| Self-check detects off-glossary synonym | Section 246 uses word not in Glossary Terms | Self-check repair attempted; repair replaces with matched Glossary Term; outcome recorded | Repair fails → section shown with flag, outcome recorded |
| Section cap breach detected | Section draft exceeds word cap (e.g., s242 > 350 words) | Self-check repair attempted; repair shortens draft; outcome recorded | Repair fails → section shown with flag and actual word count recorded |
| Profile instruction exceeds cap (e.g., line limit on s242) | Writer's instructions demand a line count that conflicts with Locked Rules | Instruction applied up to the cap; Compliance Note records "cap met" with actual values | No error expected |
| Consistency pass detects contradiction between sections | Section 242 establishes fact X; section 246 contradicts it | Consistency pass flags the sections involved; Compliance Note records "section contradiction detected" with location; section is shown to writer | No error expected; writer can then revise |
| `iterative` mode generation | Project + `iterative` candidateMode | Section-by-section generation with human approval gates; Build Order and compliance tracking unchanged; one-shot ghost candidate still runs | No error expected; iterative gating unaffected |
| All sections drafted, none pass self-check | Scenario triggers repair failure on every section | All three sections shown with flags; Compliance Note lists all failures; writer can revise via chat or re-request | No error expected; writer informed |

</intent-contract>

## Code Map

- `convex/writerProfiles.ts:46-100` -- Add `buildOrder` (v.optional array of section names) and `selfCheckRules` (per-paragraph customization) to profile validator and upsert flow
- `convex/writerProfiles.ts:215-237` -- Extend `getEffectiveWriterStyle` to return `{ customInstructions, styleOverrides, buildOrder, selfCheckRules }` and report which tier applies (House Rules | Writer Profile | Org Mode | Locked Rules)
- `convex/schema.ts` -- Add optional `complianceNotes` field to `generations` table to store per-section compliance and self-check outcomes
- `convex/ai/promptProgram.ts:250-263` -- Replace parallel `["section242", "section244", "section246"]` in `candidatePipeline` with ordered array and conditional prior-section context injection; keep `iterative` mode unchanged
- `convex/ai/selfCheck.ts` -- New module or extend `convex/ai/qaAgent.ts` with `runSelfCheck(section, sectionNumber, brief, profile, priorSections) → { pass: boolean, repairs: Repair[], outcome: string }` using the rubric from CAP-9 (exclusions, glossary calibration, paragraph rules, Locked Rules)
- `convex/ai/promptProgram.ts:235-260` -- Add a self-check stage after each section generation: `{ selfCheck: ["selfCheck242", "selfCheck244", "selfCheck246"] }` at the same indentation level as sections; conditionally run repair if check fails
- `convex/ai/postQa.ts` -- Extend assembled-draft consistency pass: detect claim contradictions, section-level consistency, record flagged sections and reasons
- `convex/lib/complianceNote.ts` -- New: `compileComplianceNote(generation, repairOutcomes, profileTiers) → ComplianceNote` object with per-section records: `{ section, appliedInstructions[], notAppliedReasons[], repairAttempted, repairOutcome }`
- `convex/ai/pipeline.ts` -- Modify the generation orchestration to: (1) read Build Order after analyzer, (2) wire prior-section context into each section call, (3) insert self-check after each section, (4) collect repair outcomes, (5) run consistency pass once at the end
- `convex/ai/prompts.ts` -- Add self-check system prompts and request schemas for each section (qaSystemTemplates extension or new selfCheckSystemTemplates); add Compliance Note instruction injections per section
- `shared/generationModels.ts` -- Verify call budget accounting: per-section is `1 generation + 1 self-check + 0–1 repair`; consistency pass is 1 call; total per generation is roughly 3 sections × (2–3 calls) + 1 consistency = 7–10 calls
- `convex/_generated/ai/guidelines.md` -- Verify no new schema tables; all data fits in `generations` `complianceNotes` field and existing audit structures

## Tasks & Acceptance

**Execution:**
- `convex/writerProfiles.ts` -- Add `buildOrder` and `selfCheckRules` to validator; extend upsert to accept and store them; add index `by_userId_and_buildOrder` if custom ordering needs fast queries
- `convex/writerProfiles.ts:215+` -- Extend `getEffectiveWriterStyle` to return compliance tier info and Build Order; update `getProfileForGeneration` query to include tier and order info
- `convex/schema.ts` -- Add `complianceNotes: v.optional(v.string())` to generations table to store JSON-serialized compliance outcomes per section
- `convex/ai/selfCheck.ts` -- Implement self-check rubric for CAP-9: check each section against Brief (Claim Exclusions, Glossary Terms), profile paragraph rules, Locked Rules (caps, skeleton); return pass/fail + repair guidance
- `convex/ai/promptProgram.ts` -- Update `candidatePipeline` to order sections by Build Order; add conditional prior-section context to section requests; keep `iterative` mode topology unchanged
- `convex/ai/pipeline.ts` -- Wire orchestration: read Build Order after analyzer, pass prior-section context, insert self-check stages, run one consistency pass before final section
- `convex/lib/complianceNote.ts` -- Compile compliance records from repair outcomes and profile tier decisions; store as JSON on generation
- `convex/ai/postQa.ts` -- Extend consistency pass to flag section contradictions and record findings
- `convex/ai/prompts.ts` -- Add self-check prompts and Compliance Note injections per section
- Tests: `convex/ai/selfCheck.test.ts` (new) -- Test self-check against excluded claims, off-glossary terms, cap breaches, unresolved facts; fixture for one repair pass
- Tests: `convex/ai/pipeline.test.ts` (extend) -- Ordered generation produces sections in custom Build Order; prior-section context is passed; consistency pass runs once
- Tests: `convex/writerProfiles.test.ts` (extend) -- Profile with custom Build Order returns correct order; disabled profile uses default; tier decisions recorded in compliance notes

**Acceptance Criteria:**
- Given a project in `single` mode with a Writer Profile, when generation is requested, then sections are generated in the profile's Build Order (or default 242 → 244 → 246 if profile is missing/disabled), each section receives prior-section context, and no approval gate exists between sections
- Given a section draft that contains an excluded claim from the Brief, when self-check runs, then a repair is attempted and the outcome (success or failure) is recorded in the Compliance Note
- Given a section draft with a word cap breach, when self-check runs, then a repair is attempted up to the cap, and the Compliance Note reports the breach and repair outcome
- Given a Writer Profile with a custom Build Order, when generation is requested, then sections are generated in that custom order; if the order is invalid (contains non-existent section), the default order is used and reported in Compliance Note
- Given a Writer Profile with custom paragraph rules, when a section violates a rule, then the Compliance Note records the rule name, the instruction applied/waived, and the reason (e.g., "cap met at 350/350 words")
- Given a disabled or missing Writer Profile, when generation is requested, then the Compliance Note reports "no Writer Profile applied" and sections are generated using House Rules only
- Given all three sections drafted, when the consistency pass runs, then any claim contradictions are detected and flagged in the Compliance Note with section references and specific text passages
- Given `iterative` mode generation, when a request is made, then the gated section-by-section workflow with human approval is unchanged; Build Order and Compliance Notes are stored the same way
- Given the generation is completed, when the writer views the report, then the Compliance Note is visible alongside the draft and lists per-section: applied instructions, un-applied instructions with reasons, repair attempts and outcomes, and consistency-pass findings

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. Do not modify or delete existing entries.
     Each entry records: what finding triggered the change, what was amended, what known-bad state
     the amendment avoids, and any KEEP instructions (what worked well and must survive re-derivation).
     Empty until the first bad_spec loopback. -->

### 2026-09-10 — High-severity bad_spec loopback

**Triggering findings:**
- getProfileForGeneration return type changed from nullable to always-object; callers expecting null bypass buildOrder injection
- Build Order validation throws error instead of graceful fallback per spec

**Amendment to Boundaries & Constraints section:**
- Build Order fallback behavior: "Build Order cannot be derived... use House Rules default (242 → 244 → 246)" — updated to mean: validation errors do not throw; invalid sections cause silent fallback to default; Compliance Note records the fallback reason.

**Amendment to Tasks & Acceptance:**
- Added test requirement: Build Order validation fallback tested; invalid sections cause default order with compliance note explanation.

**KEEP instructions:**
- Schema additions (complianceNotes, buildOrder fields) and data structures (selfCheckOutcome, complianceNote types) are correct and must survive re-derivation.
- writerProfiles.ts tier tracking and buildOrder storage are correct; fix only the validation error handling and return type contract.

## Review Triage Log

### 2026-09-10 — Review pass
- intent_gap: 0
- bad_spec: 2: (high 2)
- patch: 7: (medium 5, low 2)
- defer: 16: (medium 16)
- reject: 0
- addressed_findings:
  - `[high]` `[bad_spec]` getProfileForGeneration contract change: return type now always object, not nullable; callers checking `if (!profile)` will skip buildOrder injection
  - `[high]` `[bad_spec]` Build Order validation throws INVALID_INPUT error on invalid sections; spec requires graceful fallback to default order with compliance note
  - `[medium]` `[defer]` Phases 3-6 incomplete: orchestration, prompts, test files, consistency pass, repair pipeline (documented as deferred to next cycle)
  - `[medium]` `[defer]` Missing selfCheckRules field mentioned in spec but not implemented (phases 3-6)
  - `[medium]` `[patch]` Duplicate sections in buildOrder not rejected (e.g., ["242", "242", "246"])
  - `[medium]` `[patch]` Empty exclusion.text in claimExclusions matches all drafts
  - `[medium]` `[patch]` sectionMetrics() call lacks error handling
  - `[medium]` `[patch]` JSON.parse() in deserializeComplianceNote lacks error handling
  - `[low]` `[patch]` invalidBuildOrderReason could be undefined in summary
  - `[low]` `[patch]` section.selfCheck not guarded with optional chaining

## Design Notes

**Ordered generation with prior-section context:** The default Build Order (242 → 244 → 246) matches the Locked Rules structure, but writers need flexibility to reorder sections based on narrative flow (e.g., 246 "Findings" first to establish facts, then 242 "Executive Summary" second). Prior-section context is injected as a delimited data block into the section prompt so the model can reference established facts and avoid repeating claims.

**Self-check rubric:** The self-check validates the section against the Brief (no excluded claims, no off-glossary synonyms) and the profile's own rules (paragraph density, line limits, cap compliance). If a check fails, one repair is attempted using the same model + `two-attempt-repair` policy. If repair fails, the section is shown with a flag and the outcome is logged; the writer can then revise via chat or re-request generation.

**Compliance Note design:** Stores per-section decisions: which instructions were applied (from which tier: Locked Rules, House Rules, Writer Profile, Org Mode), which were not (and why: overridden, disabled profile, cap hit), and which repairs were attempted (outcome: pass/fail/not-needed). This makes the entire generation auditable and supports the Pre-Claim Approval regime's need for defensible narratives.

**Consistency pass:** Runs once over the assembled draft (all three sections together) after they are all drafted. Detects contradictions (e.g., a claim established in 242 contradicted in 246) and flags them for the writer to resolve. The pass does NOT auto-repair; it flags and records.

## Verification

**Commands:**
- `bash scripts/loop-verify.sh` -- Convex typecheck, svelte-check, vitest (incl. `selfCheck.test.ts`, `pipeline.test.ts` ordered generation tests), discovery guard, build, uploader harnesses
- `npm test -- selfCheck` -- Self-check rubric: excluded claims, off-glossary terms, cap breaches, one repair pass, stale section detection
- `npm test -- pipeline` -- Ordered generation: custom Build Order respected, prior-section context passed, consistency pass runs once
- `npm test -- writerProfiles` -- Profile Build Order parsing, disabled/missing profile fallback, compliance tier recording
- `npm run build` -- Ensure TypeScript compiles, schema validates

**Manual checks (if no CLI):**
- Verify `generationBriefs` and `generationBriefEntries` are queried as read-only in selfCheck.ts (Story 1 data)
- Confirm `complianceNotes` field is optional on `generations` and never mutated directly (route all updates through `compileComplianceNote`)
- Check that `iterative` mode's approval gates remain unchanged in `promptProgram.ts`
