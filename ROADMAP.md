# Banhall SR&ED Tool — Roadmap

A living roadmap turning Michael's feature list into a sequenced, buildable plan. Ordered by the
priority ranking Bikram gave in the kickoff meeting and chunked into the Tuesday/Friday sprint
cadence. This is the engineering-facing companion to Michael's working doc — add feedback freely.

**Strategy:** Ship as a *beta* the moment it's usable — no hard launch. Get it into writers' hands
fast, collect in-tool feedback, iterate every sprint, and fully transition off ChatGPT by ~Sept 1.
Bikram was explicit that **one feature unblocks beta: the interactive re-prompt.** Everything else
layers on after.

---

## Status today (already built)

The product is further along than the feature list assumes. Working today:

- **Transcript → PD pipeline** — 7-agent Claude pipeline (`convex/ai/pipeline.ts`): analyzer →
  parallel CRA Line 242 / 244 / 246 drafters → QA scorecard → chronology table. Core prompts in
  `convex/ai/prompts.ts`; deterministic banned-word scrub + CRA opener / BECAUSE-clause checks in
  `convex/ai/qaChecks.ts`.
- **Rich text editor** — TipTap with slash commands + auto-save (`src/components/editor/Editor.tsx`).
- **Comments & client review** — margin comments, highlights, suggested edits, public share-token
  review page (`/review/[shareToken]`), view tracking.
- **DOCX export**, **dashboard** with status filters, **questionnaire** self-serve intake.
- **Financial / timesheet foundation** — file uploads + LLM timesheet extraction + SR&ED eligibility
  flagging (`convex/financial.ts`, `convex/ai/financialAgent.ts`).
- **Auth** — Convex Auth, share tokens, owner/commenter permissions.
- **Model:** all agents on `claude-sonnet-4-20250514`.

| Module (Michael's list) | Status |
|---|---|
| Transcript → PD generation | ✅ Built |
| Rich text editing of the PD | ✅ Built |
| **#1 Interactive re-prompt** | ❌ Not built — blocks beta |
| **#2 Contextual pre-inputs** | ⚠️ Partial (raw transcript + financial only) |
| **#3 The Brain (knowledge base)** | ❌ Not built |
| PD Review Module | ⚠️ Foundation = QA scorecard |
| Technical Writer Profile | ❌ Not built |
| Costing Generation | ❌ Not built |
| Timesheet Generation | ⚠️ Partial (financial pipeline exists) |

---

## Phase 1 — Interactive re-prompt ⭐ unblocks beta

**Priority #1.** The single feature needed to put the tool in writers' hands — otherwise they
copy-paste into ChatGPT/Word. Mirrors how the team already works.

1. **Inline highlight → re-prompt** — select a sentence/paragraph, an inline prompt box appears,
   writer types an instruction, Claude rewrites just that span. Accept / reject / re-run.
2. **Whole-document chat** — a panel scoped to the full report ("summarize the interview", "did we
   address all the iterations?", "what SR&ED criteria are missing?").

**Notes:** new refine action reusing the Anthropic client + `SHARED_WRITING_RULES` / banned-word
scrub so re-prompts stay on-style; reuse the editor's existing selection-offset tracking; persist via
`updateReportContent`. **Log every re-prompt from day one** (`promptLogs` table) — it feeds the Brain's
learning loop in Phase 3.

- Sprint 1a: inline highlight → re-prompt (single span + accept/reject) + logging.
- Sprint 1b: whole-document chat panel.

**Exit criteria for beta:** a writer can generate and fully refine a PD in-tool without leaving for ChatGPT.

---

## Phase 2 — Contextual inputs (the "pre-prompt" layer)

**Priority #2.** Structured-but-open intake of the ~10–15 recurring data points (most claims use 6–8).
Two tiers: **global/universal** (Banhall template, CRA guidance — graduate into the Brain in Phase 3)
and **report-specific** (previous-year PD, scoping transcript, technical interview transcript, the
writer's "unreliable narrator" notes, background summaries, links).

> ⚠️ **This section is intentionally a placeholder — Bryce/Michael have a lot to define here.**
> Scope, weighting, and UX of the AI input layer to be detailed before building.

---

## Phase 3 — The Brain (knowledge base) + learning loop

**Priority #3.** The amalgamation that makes context superior to public sources.

- Public knowledge (CRA site + guidance), internal templates, continually-updated "don't say X" prompt.
- **PD database** — ~2,000 PDs and ~500 transcript→PD pairs (the ML-quality sample teaching Banhall's
  abstraction move).
- **Quality weighting (confidential)** — per-writer KPI scores; Tracy = gold standard; others ~3.5/5;
  deprioritize/ignore weak writers. Kept private from the team.
- **Industry routing** — software / manufacturing / life sciences kept distinct; auto-detect and route.
- Audit-flagged PDs + KPI scores as signals.
- **Learning loop** — logged re-prompts → admin review → approved patterns update the global prompt/Brain.
- **Cross-project linking** — a company's projects linked so prior PDs are available as context.

Multi-sprint: (a) ingest + tag corpus; (b) retrieval + weighting into the pipeline; (c) admin
learning-loop UI; (d) cross-project linking. Evaluate Opus for the core abstraction step here.

---

## Later phases

- **PD Review Module** — writer self-review + an assistive tool for a second human reviewer who
  didn't sit in the interview. Metrics: accuracy vs. transcript, divergence from the AI's original
  draft, criteria coverage, narrative clarity. Foundation = existing QA scorecard.
- **Technical Writer Profile Module** — per-writer analytics + coaching feedback over time.
- **Costing Generation Module** (~Michael's #7–8) — timelines + costing working papers; financial side.
- **Timesheet Generation Module** (~#12) — CRA support timesheets from interviews, emails, WhatsApp,
  invoices, Git/Jira logs. Partly built already.

---

## Cross-cutting workstream — ops, data & rollout

1. **Account migration (NDA-critical).** Move to Banhall-owned infra: Anthropic/Claude (Max + API key),
   Convex, Git. Only sanitized data until done. Target: transitioned + ChatGPT cancelled ~Sept 1.
2. **PD corpus import.** Batch script (with Johnny) over Banhall's server for the ~500 transcript→PD
   pairs; manual gap-fill as last resort. Hard dependency for Phase 3.
3. **Beta rollout.** Ship as live beta when Phase 1 lands; gather in-tool feedback.
4. **Privacy controls.** Writers can keep content private from the team; private info never stored in the Brain.
5. **Tool name.** Working title TBD.

---

## Suggested first two sprints

- **Sprint 1:** Phase 1a — inline highlight → re-prompt + logging. In parallel: scope account
  migration + corpus import with Johnny/Lauren.
- **Sprint 2:** Phase 1b — whole-document chat; begin Phase 2 once the AI input layer is defined.
