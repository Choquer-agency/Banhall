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
