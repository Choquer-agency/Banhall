# Owner decisions — 2026-09-17

Recorded from the product owner's chat answers on 2026-09-17 to the questions the PRD, spine and spec left open. Each row says what was asked in plain terms, the answer, and where it was applied. The nine PRD open questions and the spine's Q-A, Q-B, Q-D were put to the owner; the owner accepted every recommendation except the seed-stage cap, which was removed entirely.

| # | Question (plain terms) | Answer | Applied in |
|---|---|---|---|
| 1 | Should the tool stop a writer from regenerating or asking for more feedback once a project has used 60 AI calls? | **No cap.** Writers can ask for any change until the PD is done. Usage is metered and shown, with an informational notice at 40 requests; nothing is ever refused on usage. | PRD NFR-3, FR-13, FR-27, §10 row 4; spine AD-34 (metering only, `consecutiveFailures` replaces the allowance, no `extendBudget`), Conflicts C1 and C3 withdrawn; spec CAP-14; product-domain amendment item 3 |
| 2 | The approval moment moves from "approve each section's prose" to "approve the bullet summary, then write all prose". OK for new projects? | **Yes.** Old in-flight projects keep the old stepper. | PRD §10 row 8; spine C2 approved, AD-31/AD-37/AD-40; product-domain amendment item 2 |
| 3 | If a writer knowingly selects an idea that overlaps a Claim Exclusion, draft it and record the conflict (not silently rewrite it)? | **Yes.** Warn at approval, record the confirmation, draft it, note the conflict. | PRD FR-15, FR-41; spine C4 approved, AD-37; product-domain amendment item 4 |
| 4 | Is Work plan optional? | **Optional.** | PRD FR-2, OQ-1; spec CAP-2 |
| 5 | After sign-off, land in the editor or approve each section's prose again? | **Editor.** | PRD OQ-2, §7; spine Q-B closed |
| 6 | Keep the background one-shot "ghost" draft for this mode? | **Retire it.** | PRD OQ-5, §8.2, §10 row 9; spine Q-A closed; product-domain amendment item 8 |
| 7 | Edited or uncited ideas at sign-off: per-item confirmation or just a marker? | **Marker only** (treated as Writer's Notes). | PRD FR-7, OQ-9; spec CAP-3/CAP-13 |
| 8 | Tags: the six positioning tags only, or add a sentiment axis? | **Six only** for v1. | PRD §2, OQ-8; spine AD-35 |
| 9 | Learning: counts on the admin health page only for v1, or feed digests now? | **Counts only.** | PRD FR-34, OQ-4; spine AD-39, C6 acknowledged |

Closed on 2026-09-17 by delegated judgement (owner: "use your best judgement"):

- **Latency placeholders:** 12 s median / 30 s p95 per Batch and the notice at 40 requests are the working targets; story 7 measures on the production model and adjusts by dated amendment.
- **Discovery (OQ-7):** relabel to "Step by step" with the hint "Decide the ideas first, then generate the PD", listed first among the three modes for the first two projects; revisit with Michael after that (story 8).
- **Retention (spine Q-C):** seed records live and die with the project; no separate retention window.

Where to look when coming back to this:

- PRD: `prd.md` (this folder), status final, updated 2026-09-17; `.memlog.md` has the full decision trail.
- Spine: `../../architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/ARCHITECTURE-SPINE.md`, ADs 31–45, Conflicts table, `reviews/`, `.memlog.md`.
- Spec and stories: `../../../specs/spec-step-by-step-seeds/` (`SPEC.md`, `glossary.md`, `state-machine.md`, `build-sequence.md`, `stories.yaml`).
- Domain contract: `docs/product-domain.md`, amendment dated 2026-09-17.

## Owner decision, 2026-09-23

| # | Question (plain terms) | Answer | Applied in |
|---|---|---|---|
| 10 | Which generation settings should the Summary Review show beside Sign off? | **The model only**, plus the Summary version when the Summary has been regenerated (version 2 or later). No length target and no Writer Profile on that view; both stay frozen at start and recorded at Sign-off. Came from the summary design review in Paper (board "SUM-A6, Sign-off bar options", option 1). | PRD FR-21, UJ-4 path (`prd.md`, updated 2026-09-23). Not yet applied to spec CAP-11 (`SPEC.md`) or build-sequence step 6. |
| 11 | Should a writer's edit to a Seed be limited to 25 words and one sentence? | **No hard limit for writers.** The cap stays on AI-proposed Seeds. The editor shows no word counter; past 25 words or one sentence a quiet "Long for a seed" note appears and Save still works. The report's CRA line and word limits are still enforced at prose generation. | PRD FR-11, FR-22, Glossary "Idea Seed" (`prd.md`). Paper boards "SUM-A6" and "S1s · Edit, final". Not yet applied to `SPEC.md`. |

## Owner decisions, 2026-09-24

| # | Question (plain terms) | Answer | Applied in |
|---|---|---|---|
| 12 | Should the writer see the report forming while it is written? | **Yes.** Section by Section reveal with a progress pill whose border fills, a skeleton for the Section being written, a corner ring while reading, and a self-closing "draft ready" message. No word-by-word streaming. | PRD FR-42 (new). Paper "Final screens" row 4. |
| 13 | Should QA hold back the report? | **No.** The report is created as soon as the Sections are drafted and checked; QA starts on its own in the background and reports through a corner notification and the QA toggle. | PRD FR-26 (amended), FR-44 (new). Needs the ordered chain to complete before QA (backend change). |
| 14 | Can the writer stop drafting after Sign-off? | **Yes.** Stop keeps finished Sections, marks the rest "Not drafted", skips QA, and leaves recovery available. | PRD FR-43 (new); FR-31 still covers cancel before Sign-off. |
| 15 | Is the Paper "Final screens" page the UI contract for this feature? | **Yes.** It replaces the earlier UI description in the stories 5 to 6 story. | Spec UI contract `ui-design-final.md`; story 5-6 amended. |
| 16 | What should the project Details panel show, and how do stage changes and handoffs work there? | **Status card first, then facts (board 5.1y, V1).** One line "[stage] with [person]" for the current handoff (stage alone when nobody has it), Change stage and Hand off buttons, no due dates, no project title or client. Facts: Industry, Fiscal year as "2026 (June 30, 2026)" with a calendar picker, Science code, Project number, Owner, Created, Edited. A handoff picks a person and a stage (the stage replaces the work type on screen), with an optional note. | PRD FR-45 and spec CAP-19 (amended); `ui-design-final.md` section 8; Paper "Final screens" 5.1, 5.2 and 5.1y. |
| 17 | How far should underlined quotes on seeds go in this build? | **Exact quotes only.** A phrase is underlined when it matches the cited interview excerpt word for word; hovering shows the quote, its source and "Open in transcript". Dotted paraphrase underlines wait for a later change to the AI seed output. | `ui-design-final.md` section 11. |
| 18 | Can a handoff move the project to any stage? | **Yes, within the stage rules.** Recorded as a dated amendment in `docs/product-domain.md` (2026-09-24). Submitted and Delivered stay unavailable until their required records can be stored. | `docs/product-domain.md`; `ui-design-final.md` section 8. |
| 19 | What happens to working features the approved screens do not show (Skip step, Brief, outline resize, top-bar tools, Details extras)? | **Keep them, tucked away:** a More menu in the top bar and the step header, and a quiet More section at the bottom of Details. | `ui-design-final.md` section 11. |
| 20 | After Stop, should redrafting keep the writer's edits? | **Yes.** Redrafting after Stop writes only the Sections marked "Not drafted" into the same report and keeps every edit made to the drafted Sections. | PRD FR-43, spec CAP-17 (amended); `ui-design-final.md` section 11. |
| 21 | Should a scheduled job keep the app on the best current models? | **Yes, fully automatic.** A daily job refreshes a model catalog from OpenRouter (with its Artificial Analysis scores) and switches models on its own once a candidate passes an evaluation on real transcripts and stays within a cost cap. Guardrails: each generation keeps the model it started with, every switch is logged and announced to admins, one-click rollback, and a kill switch. | To be built in phase 2 on `feat/seeds-5-6-ui`. |
| 22 | In what order should the generation, cost and transcript work happen? | **1 cost quick wins, 2 model catalog, 3 transcript method, 4 generation structure.** | Research of 2026-09-24 (OpenRouter and Artificial Analysis, Granola and industry cost strategies, code audit). |
| 23 | Where does that work live? | **On the same branch as the Step-by-step UI** (`feat/seeds-5-6-ui`, PR #22). | |
| 24 | Must a consultant confirm detected speaker roles before generating? | **No, warn only.** Generation runs with the detected roles; a "Needs a check" chip invites confirmation. | Phase 3 (transcript method). |
| 25 | Can the interviewer's own words be cited as evidence? | **No.** Only client turns back a claim; interviewer turns give context and are never cited. | Phase 3. |
| 26 | Should names be replaced by placeholders before transcripts reach a model? | **Always, for every model including Claude.** People and company names become placeholders such as [CLIENT_1] and [PERSON_2] and are restored in the output. | Phase 3. |
| 27 | Facts only, or full transcripts too? | **Facts for long transcripts; small projects keep full text** until an evaluation on three real transcripts shows facts match quality, then they switch. | Phase 3. |

## Owner decisions, 2026-09-25

| # | Question (plain terms) | Answer | Applied in |
|---|---|---|---|
| 28 | Can a project be duplicated to run Step by step again with the same material? | **Yes, from a hover button.** Project cards and Home rows show Duplicate on hover or focus. It opens New project filled in from that project with Step by step selected and the files listed; on create it copies the transcripts and files, not the old report, and starts the chosen generation. The old plain copy link still makes a full clone. | Merged 6d078537 into `feat/seeds-5-6-ui`. |
| 29 | Which new models should writers be able to pick? | **Opus 5.5, GPT-6 Sol and GPT-6 Luna.** Fable 5.1 is taken out. Models that reject a forced tool call (Opus 5.5) get an unforced tool choice and never disabled thinking, and stay out of random compare draws. | Merged 4e4a0804 and 7c8fae8a. |
| 30 | Should every model go through OpenRouter? | **Yes, as the target.** Billing on OpenRouter credits; Anthropic models pinned to Anthropic's own endpoint with no fallback host; the report chat moves later; OpenRouter prompt sampling turned off in the account. The direct Anthropic path stays behind a switch for rollback. | Built behind `ANTHROPIC_TRANSPORT` (default `direct`, byte-identical requests), merged in aa91acac with the switch off; every Anthropic model sent through OpenRouter is pinned to Anthropic with no fallback. Switch-on waits for the owner's OpenRouter account steps (see `docs/product-domain.md`). |
| 31 | Where should today's work live for testing? | **All of it on `feat/seeds-5-6-ui`** (the branch behind the local app on port 5173), including phase 4. | Merged 9085f3ce; phase 4 backfills run on the local test deployment. |
| 32 | Which speed changes should be built now? | **Reorder the start:** the Brief runs alongside the transcript analysis, and the analysis and Brain search move to the background and must finish before sign-off. Not now: faster compression, the Brief at upload, parallel sections. | Speed research in `HANDOFF-banhall-files/research/speed-*.md`; to be built. |
| 33 | Should Google Gemini be used for the analysis and Brief? | **Test first.** Run Gemini 3.8 Flash, pinned to Google Vertex, side by side with Sonnet 5 on the fictional demo transcripts with pass thresholds; switch only if it passes. | Tested 2026-09-25 on the fictional demo transcripts ($2.67): **failed both stages** (analyzer 85% of Sonnet 5's time and under half its recall; Brief about twice as slow). Keep Sonnet 5. Report: `HANDOFF-banhall-files/research/gemini-ab/report.md`. |
| 34 | Should Random compare draws include Opus 5.5? | **Yes.** Random draws use Sonnet 5, Opus 4.8, Haiku 4.5 and Opus 5.5. Other models that reject a forced tool call (Fable 5.1, Mythos 5.1) stay out, and OpenAI and Google models stay an explicit choice. Replaces the random-draw part of decision 29. | Branch `ui/random-opus`. |
| 35 | What should Duplicate bring over? | **Every file from the source project** (all transcripts and supporting documents), each one untickable on the New project screen before create. Duplicating a Review PD project stays Review PD and does not offer Step by step. | Research in `HANDOFF-banhall-files/research/2026-09-25-decisions/`; to be built. |

Decisions 36 to 42 below were made by the lead on 2026-09-25: the owner delegated them ("do what you think is best then let me know the final decision"). Each matching domain note is marked approved.

| # | Question (plain terms) | Answer | Applied in |
|---|---|---|---|
| 36 | Keep the two story 4 changes that made real Step-by-step runs work? | **Yes.** The Summary Self-check limit stays at 16,384 bytes, and long Self-check explanations are trimmed instead of failing plan coverage. A trimmed Storyline suggestion is never offered. | Story 4 amendments, 2026-09-25. |
| 37 | Should a failure caused by our own action time limit count toward automatic model rollback? | **No.** It is not the model's fault. Every other failure that outlasts its retries still counts (decision 21). | `docs/product-domain.md` review notes. |
| 38 | May a retry after a too-long transcript analysis ask for a shorter one? | **Yes.** The first attempt's request is unchanged; only retries add the note. | Amendment 2026-09-25 (third). |
| 39 | Keep the Duplicate wording and defaults as built? | **Yes.** "Leave anyway" after 30 seconds, the failed-copy messages, the old report only when the fiscal year moves forward, same-year ported PDs unticked, Financial page uploads left behind, and Review PD copies blocked from Step by step in the wizard. | Amendment 2026-09-25 (fourth). |
| 40 | In facts mode, how are words from a speaker with no confirmed role treated? | **Kept, with a "Needs a check" note** (decision 24, warn only). | Transcript method notes. |
| 41 | If even the shorter analysis retry fails, may the writer continue without the full analysis? | **Not now.** Cancel stays the way out. The failure is stored with a code, so it can be counted; revisit if it happens in real use. | No change. |
| 42 | May a draft be built from last year's report alone (every transcript and current file unticked)? | **No.** At least one current-year source (a transcript or a non-previous-year file) is required, so last year's work is never written up as this year's claim. | Amendment 2026-09-25 (fourth), decision 42 note: enforced in `reserveGeneration` (reason `PREVIOUS_YEAR_ONLY_SOURCES`) and shown in the wizard. |

The lead also made three counting calls for automatic model rollback on 2026-09-25, under the same delegation. A retry refused because the provider's Retry-After wait (about 520 s or more) could not fit even a fresh action counts: that is not the action time limit's doing (decision 37 still excludes the rest). An answer cut off at the output limit counts only when it makes its step fail: section drafts, structured calls and science code suggestions. A cut-off compression, repair, Brain context blurb, feedback summary or changelog summary records nothing, the same on both gateways. A roster near miss (a name that matches a staff member's first name but not the whole name) only leans toward interviewer at 0.6, below the 0.7 threshold, so the model decides. Applied in fix/p3-sweep, 82005dfd and fix/cutoff-count; the domain notes are in `docs/product-domain.md`.

## Owner decision, 2026-09-25 (later)

| # | Question (plain terms) | Answer | Applied in |
|---|---|---|---|
| 43 | Which model runs each step of a report? | **The model the writer picks writes the report** (Section drafts, repairs, compression, redrafts). Helper steps need not use it: a `planning` role runs the analysis, the Brief and the seed cards, and a `checking` role runs the Self-check, consistency, QA and chronology. Both default to Sonnet 5, are frozen per generation, can be reassigned on `/admin/models` and do not switch on their own yet. Compression turns thinking off. | `docs/product-domain.md` (fifth note of 2026-09-25); branch `fix/model-routing`. |

Still waiting on the owner: the OpenRouter account steps before `ANTHROPIC_TRANSPORT` is switched on (see decision 30).