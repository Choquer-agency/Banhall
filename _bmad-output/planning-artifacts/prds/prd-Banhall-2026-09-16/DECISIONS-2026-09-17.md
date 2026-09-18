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
