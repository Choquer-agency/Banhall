# Spine Pair Review — Banhall PD generation

## Overall verdict

A tight, well-inherited contract: every source path resolves, all five UJ names are verbatim from `user-journeys.md`, all 20+ colour tokens are hex with resolving `{}` refs, and both files follow their canonical section order. One load-bearing gap breaks the clean read: the `compliance-line` component's per-instruction status-pill is specified with a vocabulary (`applied` / `not applied`) that none of DESIGN.md's three defined status-pill variants (`resolved` / `blocked` / `conflicting`) cover — a downstream implementer has no token to reach for and, per the project's "no invented colours" discipline, no license to invent one. Visual reference coverage is currently empty (expected — mocks are scheduled for Finalize, not this pass), which is a real but explainable gap, not a defect.

## 1. Flow coverage — strong

Extracted UJ-1 through UJ-5 from `user-journeys.md` frontmatter/source. All five appear in EXPERIENCE.md § Key Flows with identical titles, a named protagonist (Larry ×3, Tracy, Michael), numbered steps, a `**Climax:**` beat, and a failure/edge path everywhere the source has one (UJ-1, UJ-2, UJ-3, UJ-5). UJ-4 has no edge case in either the source or the spine — consistent, not a miss.

### Findings
None.

## 2. Token completeness — strong

Extracted all 21 `colors` keys, 5 `typography` roles, 3 `rounded` scale values, 3 named `spacing` tokens, and 16 `components` entries from DESIGN.md frontmatter, plus every `{path.to.token}` reference in the body (Colors, Typography, Layout & Spacing, Shapes, Components prose) and inside the `components` YAML block itself. Every reference resolves to a defined frontmatter key; every colour carries a hex string. Contrast is stated for the one load-bearing pair ("Lagoon text on white is below AA... every lagoon-meaning text... uses `primary-selected`"), matching `docs/design-system.md`'s own AA note.

### Findings
None.

## 3. Component coverage — adequate

Extracted 16 component names from DESIGN.md § Components and cross-checked against EXPERIENCE.md § Component Patterns: all 16 have a row in both files with real behavioural rules (not one-word descriptions). One of those rows carries a genuine gap.

### Findings
- **critical** `compliance-line`'s expanded well renders "outcome as a status-pill" (DESIGN.md § Components, `compliance-line`) and EXPERIENCE.md's `compliance-line` row (Component Patterns, line 67) names that pill's states as "applied · not applied." But DESIGN.md only defines three status-pill variants — `status-pill-resolved`, `status-pill-blocked`, `status-pill-conflicting` — all keyed to Completion Report vocabulary (resolved/blocked/conflicting), and EXPERIENCE.md's own `status-pill` row (line 74) declares those same three variants as what compliance-line uses. Neither file states which colour token "applied" or "not applied" maps to, and none of the three existing variants is a clean fit (compliance-line's "not applied" reasons are locked / org-enforced / conflict / missing fact — a four-way split, not blocked-vs-conflicting). *Fix:* either add a fourth pair of status-pill tokens (`status-pill-applied` / `status-pill-not-applied`) with explicit hex refs reusing existing colours, or state explicitly in both files that compliance-line reuses `status-pill-resolved` for "applied" and `status-pill-blocked`/`status-pill-conflicting` chosen by reason-tier for "not applied."
- **low** The admin comparisons surface (`/admin/comparisons`, spine-only per `.memlog.md`) has zero component entries in DESIGN.md — deliberate ("no mock," reuses existing admin chrome), but the only field-level detail (project, models, judge, preference, counts, development flag) lives in UJ-4 prose, not a structured spec. *Fix:* if this surface reaches story-dev before a follow-up spine update, a one-line component stub (reusing existing Form/Table primitives) would remove the need to reverse-engineer fields from the flow narrative.

## 4. State coverage — strong

Walked all ten IA surfaces against EXPERIENCE.md § State Patterns (11 states: generating, Brief-with-nothing-derived, no-Writer-Profile, settings-detected, over-budget, Storyline-question-pending, stopped-after-a-section, zero-Deviations, blocked-only-Completion-Report, stale-proposal, rail-below-`lg`). Coverage matches the surfaces that need it; focus and error states are handled at the component level (edit-field-ring, existing `could_not_read` document status) rather than restated in the table.

### Findings
- **low** No state is defined for a section with zero relevant profile instructions (compliance-line/compliance-section render "Compliance · 0 applied · 0 not applied," or something else?). *Fix:* add one line to § State Patterns, or confirm "0 applied · 0 not applied" is the intended render.

## 5. Visual reference coverage — thin (expected at this stage)

`mockups/` and `wireframes/` do not exist; `imports/` is empty; `.working/` holds only `surface-map.md` (a text extract, not a visual mock). Neither spine references an image path inline — correctly, since none exist yet, so there are no dangling references or orphans to report. `.memlog.md` records three key-screen mocks as scheduled for Finalize (report workspace + Brief rail during generation; Editor compliance-line expanded; chat Coordinated Revision card), not this validation pass.

### Findings
- **low** No visual references exist yet for a spine pair this detailed (16 components, 11 states). Not a defect against this pass, but downstream consumers reading the spine today have prose and tokens only. *Fix:* render the three planned key-screen mocks at Finalize and link each inline at its section ("see `.working/<mock>.html`") per the rubric's spines-win-on-conflict convention.

## 6. Bloat & overspecification — strong

No pixel specs where tokens already cover it (typography/rounded frontmatter values are the spec format itself, not prose overspecification). No restatement of personas, FRs, or scope blocks. Tables are used where a table earns it (Voice and Tone, State Patterns, Responsive & Platform). DESIGN.md carries editorial voice appropriately ("Quiet everywhere, loud once").

### Findings
- **low** EXPERIENCE.md § Key Flows narration drifts editorial in a couple of climax/resolution beats — "he did not write a single document to get here" (UJ-1), "an acceptable PD for a project he would never have put through the tool before" (UJ-5). The rubric reserves editorial voice for DESIGN.md; EXPERIENCE.md prose should stay behavioural. *Fix:* trim these two lines to the factual outcome (e.g., "zero writer-authored documents"), matching the flatter tone of UJ-2 through UJ-4.

## 7. Inheritance discipline — adequate

`sources` frontmatter resolves cleanly in both files (verified by path resolution against actual file locations: `prd.md`, `SPEC.md`, `user-journeys.md`, `glossary.md` all found). UJ names verbatim. Glossary terms (Storyline, Claim Exclusions, Confidence Map, Glossary Terms, Compliance Note, Deviation Inventory, Coordinated Revision, Completion Report, Writer Profile, House Rules, Reference PD) are used identically to `glossary.md` in both spines. EXPERIENCE.md's one `{}` reference (`{colors.primary-selected}`, § Accessibility Floor) resolves to a DESIGN.md token by name.

### Findings
- **medium** DESIGN.md names three separate components — `status-pill-resolved`, `status-pill-blocked`, `status-pill-conflicting` (§ Components, and as three frontmatter keys) — while EXPERIENCE.md's Component Patterns table collapses them into one row, "status-pill (resolved / blocked / conflicting)." Component names are not identical across the two files, so a search for `status-pill-blocked`'s behavioural rule (or vice versa, `status-pill`'s visual spec) will not find its match. *Fix:* pick one naming convention — either give EXPERIENCE.md three rows matching DESIGN.md's three component keys, or rename DESIGN.md's frontmatter/body entries to a single `status-pill` component with a `variant` sub-token.

## 8. Shape fit — strong

DESIGN.md: all 8 canonical sections present, in locked order (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts). EXPERIENCE.md: all 8 required-default sections present (Foundation, IA, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows), plus both required-when-applicable sections earning their place — Responsive & Platform (triggered by the `≥lg`/`<lg` rail-to-sheet breakpoint) and Inspiration & Anti-patterns (triggered by three documented rejected alternatives in `.memlog.md`: Copilot's Keep/Discard/Regenerate, Brief-approval gating, inline prose compliance). No invented sections.

### Findings
None.

## Mechanical notes

- **Name inconsistency:** `status-pill-resolved` / `status-pill-blocked` / `status-pill-conflicting` (DESIGN.md) vs. the merged `status-pill (resolved / blocked / conflicting)` row (EXPERIENCE.md) — see §3 and §7.
- **No broken cross-refs.** Every `sources:` path in both frontmatters resolves to an existing file; every `{path.to.token}` reference in both files resolves to a defined frontmatter key.
- **Frontmatter completeness.** DESIGN.md carries all spec-required keys (`name`, `description`, `colors`, `typography`, `rounded`, `spacing`, `components`) plus `status`/`created`/`updated`/`sources`. EXPERIENCE.md's frontmatter (`name`, `status`, `created`, `updated`, `sources`) matches the shape of both worked examples (`experience-example-shadcn.md`, `experience-example-mobile.md`).
- No Mermaid diagrams in either file — n/a.
- Six `[ASSUMPTION]` tags remain inline in EXPERIENCE.md (Brief default-open state, Storyline character limit, Reference PD checkbox mechanism, toggle badge, "Generate the rest" action, "Copy questions for the client" action) plus one in the IA table (`[ASSUMPTION: admin route]`) — flagged inline as the spec requires, not silently assumed.
