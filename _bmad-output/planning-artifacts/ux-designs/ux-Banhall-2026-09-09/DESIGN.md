---
name: Banhall PD generation
description: Brand-layer delta on the Ledger Paper design system for the Generation Brief, Compliance Notes, Deviation Inventory and Completion Report surfaces. Inherits every token not listed here.
status: final
created: 2026-09-09
updated: 2026-09-09
sources:
  - ../../prds/prd-Banhall-2026-09-09/prd.md
  - ../../../specs/spec-pd-generation/SPEC.md
colors:
  # Existing Ledger Paper tokens this work uses (src/routes/layout.css). No new colours.
  # Dark-scope workspace surfaces are out of scope; every surface here is light.
  canvas: '#F9FCFB'
  surface: '#FFFFFF'
  chrome: '#EAF2F1'
  navy: '#0A3A38'
  primary: '#0DACA5'
  primary-dark: '#0A8A84'
  primary-selected: '#087A75'
  primary-light: '#45CFC9'
  primary-wash: '#F1FAF9'
  gap-bg: '#FEF3C7'
  gap-text: '#92400E'
  ink: '#0F1F1E'
  ink-secondary: '#3E5553'
  ink-muted: '#6B807E'
  ink-faint: '#9AABA9'
  line: '#D6E3E1'
  line-soft: '#E6EFEE'
  gray-50: '#F4F8F7'
  gray-100: '#E6EFEE'
  gray-700: '#3E5553'
  red-700: '#B91C1C'
typography:
  # Existing roles; referenced by name. Nothing in this work exceeds weight 500.
  label:
    fontFamily: 'Geist'
    fontSize: 11px
    fontWeight: '500'
    letterSpacing: 0.08em
    note: '.text-label, uppercase; the system spec says 600 but new UI caps at 500'
  body:
    fontFamily: 'Geist'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.55'
  data:
    fontFamily: 'Geist Mono'
    fontSize: 12px
    fontWeight: '400'
    note: 'tabular-nums; counts, caps, line and word numbers'
  title:
    fontFamily: 'Geist'
    fontSize: 17px
    fontWeight: '500'
    lineHeight: '1.35'
  prose:
    fontFamily: 'Georgia'
    note: 'report prose only; untouched by this work'
rounded:
  # Inherited: .card = rounded-xl (12px); pills = full.
  md: 8px
  xl: 12px
  full: 9999px
spacing:
  # Tailwind 4-based scale inherited. Named tokens this work relies on:
  rail-min: 320px
  rail-default: 400px
  section-end-gap: 8px
components:
  brief-rail:
    background: '{colors.surface}'
    border: '{colors.line}'
    header-eyebrow: '{typography.label}'
    group-band: '{colors.gray-50}'
    row-rule: '{colors.line-soft}'
  brief-entry:
    text: '{typography.body}'
    edit-field-bg: '{colors.chrome}'
    edit-field-ring: '{colors.primary-light}'
    reason-chip-bg: '{colors.gray-100}'
    reason-chip-text: '{colors.gray-700}'
    added-marker: '{colors.primary-selected}'
    removed-marker: '{colors.ink-muted}'
  origin-chip:
    derived-bg: '{colors.gray-100}'
    derived-text: '{colors.gray-700}'
    writer-bg: '{colors.primary-wash}'
    writer-text: '{colors.primary-selected}'
    edited-bg: '{colors.chrome}'
    edited-text: '{colors.ink-secondary}'
    radius: '{rounded.full}'
    text-style: '{typography.label}'
  source-chip:
    background: '{colors.chrome}'
    text: '{colors.ink-secondary}'
    hover-bg: '{colors.primary-wash}'
    radius: '{rounded.full}'
  storyline-question:
    background: '{colors.gap-bg}'
    text: '{colors.gap-text}'
    border: 'none'
    radius: '{rounded.md}'
    action-primary-bg: '{colors.primary-selected}'
    action-primary-text: '{colors.surface}'
  compliance-line:
    text: '{typography.data}'
    color: '{colors.ink-muted}'
    rule: '{colors.line-soft}'
    expanded-bg: '{colors.gray-50}'
  compliance-section:
    band: '{colors.gray-50}'
    eyebrow: '{typography.label}'
    row-rule: '{colors.line-soft}'
  inventory-checklist:
    background: '{colors.surface}'
    border: '{colors.line}'
    radius: '{rounded.xl}'
    group-band: '{colors.gray-50}'
    locator: '{typography.data}'
    action-bg: '{colors.primary-selected}'
    action-text: '{colors.surface}'
  completion-row:
    rule: '{colors.line-soft}'
    reason: '{typography.body}'
    locator: '{typography.data}'
  status-pill-resolved:
    background: '{colors.primary-wash}'
    text: '{colors.primary-selected}'
    radius: '{rounded.full}'
  status-pill-blocked:
    background: '{colors.gap-bg}'
    text: '{colors.gap-text}'
    radius: '{rounded.full}'
  status-pill-conflicting:
    background: '{colors.gray-100}'
    text: '{colors.gray-700}'
    radius: '{rounded.full}'
  status-pill-applied:
    background: '{colors.surface}'
    border: '{colors.line}'
    text: '{colors.ink-muted}'
    radius: '{rounded.full}'
  missing-facts-reply:
    list-marker: '{colors.ink-muted}'
    text: '{typography.body}'
    action-text: '{colors.primary-selected}'
  reference-pd-mark:
    checkbox-ring: '{colors.primary-light}'
    label: '{typography.body}'
    marked-chip-bg: '{colors.primary-wash}'
    marked-chip-text: '{colors.primary-selected}'
  comparisons-form:
    field-bg: '{colors.surface}'
    field-border: '{colors.line}'
    table-band: '{colors.gray-50}'
    row-rule: '{colors.line-soft}'
    numbers: '{typography.data}'
  storyline-slot:
    label: '{typography.label}'
    field-bg: '{colors.surface}'
    field-border: '{colors.line}'
    focus-ring: '{colors.primary-light}'
    weight-pill-bg: '{colors.primary-wash}'
    weight-pill-text: '{colors.primary-selected}'
  save-settings-banner:
    background: '{colors.primary-wash}'
    text: '{colors.ink-secondary}'
    button-border: '{colors.line}'
    radius: '{rounded.md}'
  inclusion-row:
    rule: '{colors.line-soft}'
    status-text: '{typography.data}'
    included: '{colors.primary-selected}'
    condensed: '{colors.gap-text}'
    not-included: '{colors.ink-muted}'
  generation-section-row:
    rule: '{colors.line-soft}'
    label: '{typography.body}'
    state: '{typography.data}'
    active-marker: '{colors.primary}'
---

## Brand & Style

A delta on Ledger Paper, not a new system. The material is still the CRA form: ruled lines, line numbers, disciplined prose. Everything this work adds sits beside the report, never on it — a rail, a line at the end of each section, cards in chat. Quiet everywhere, loud once: the single loud element on any of these surfaces is one lagoon action ("Bring all 16 into alignment", "Regenerate with this Brief"). Structure comes from bands and hairlines, never from boxes inside boxes. The report prose in Georgia is untouched; the tool's own voice is Geist at body size and Geist Mono for every count.

## Colors

No new colours; the token-to-meaning pairing for every state is authoritative in Components. What this section keeps is the reasoning:

- Lagoon text on white is below AA, so every lagoon-meaning text on these surfaces uses `{colors.primary-selected}`; `{colors.primary}` appears only as the active-section marker and the one loud button fill.
- `{colors.gap-text}` on `{colors.gap-bg}` is the existing `[GAP:]` pair; a blocked item *is* a gap — a fact the Transcript does not hold — so reusing it teaches nothing new. The same pair carries *condensed* and the Storyline question.
- A conflict with a Locked Rule is not an error; it is a fact about the CRA form, so *conflicting* reads neutral (`{colors.gray-700}` on `{colors.gray-100}`) with the rule quoted beside it. The eligibility-reason chip on a Claim Exclusion shares that register.
- A rule that was followed needs no colour: *applied* is `{colors.ink-muted}` on `{colors.surface}` with a `{colors.line}` border, and a Compliance line's *not applied* rows reuse the blocked and conflicting pills by tier rather than adding a hue.
- `{colors.chrome}` is recessed working material: edit fields, Source chips, *edited* origin chips.
- `{colors.red-700}` is reserved. Nothing in this work is an error the writer caused; red stays with the existing destructive semantics.
- `{colors.ink-muted}` for Compliance lines at rest and *not included* rows; `{colors.ink-faint}` only for placeholders.

## Typography

Existing roles only. `{typography.label}` (uppercase, 11px) is the eyebrow for every Brief group, Compliance section and Inventory group. `{typography.data}` carries every number: "5 applied · 1 not applied", "12 of 14 documents in context · cap 12", paragraph locators like "244 ¶3". `{typography.body}` is the entry text and every reason. `{typography.title}` appears once per rail (the rail title). Nothing is set above weight 500; hierarchy comes from size, case and ink tier. Report prose stays `{typography.prose}` and is never restyled by a Compliance line.

## Layout & Spacing

- **Rail.** The Brief is a view inside the existing right-docked resizable rail of the report workspace, sharing the QA rail's chrome and its draggable divider. Minimum `{spacing.rail-min}`, default `{spacing.rail-default}`. Groups are `{colors.gray-50}` bands with entries as hairline-ruled rows beneath; no cards inside the rail.
- **Section-end line.** The Compliance line sits `{spacing.section-end-gap}` below the existing section-end marker (the word/line count) and shares its typographic register. Expanded, it opens a `{colors.gray-50}` well beneath the marker, full column width, and pushes prose down; it never overlays the prose.
- **Chat cards.** The Inventory checklist and the Coordinated Revision card use the existing `.card` (`{rounded.xl}`, `{colors.line}` border) at the chat panel's content width. Completion rows are hairline-ruled inside the card above the diff.
- **New project.** The Storyline slot is one more `CategoryRow` in the context section, same width and rhythm as Writer's Notes.
- Tailwind spacing scale inherited; gutters unchanged.

## Elevation & Depth

Inherited. Rail and cards are flat white on the canvas; hover and `focus-within` answer with the existing border + soft shadow. No elevation as hierarchy.

## Shapes

Inherited: `{rounded.xl}` for cards, `{rounded.md}` for the Storyline question callout and the settings banner, `{rounded.full}` for pills and chips only. Nothing else is rounded differently from the system.

## Components

- **brief-rail** — Rail view titled "Brief" in `{typography.title}`. Body: an Inputs band, then Storyline, Claim Exclusions, Confidence Map, Glossary Terms bands, each a Disclosure with a `{typography.label}` eyebrow and a `{typography.data}` count. Rows rule with `{colors.line-soft}`. A secondary "Regenerate with this Brief" button sits at the bottom; a group header can carry a `{typography.data}` diff line ("2 added · 1 removed") with changed rows marked by a 2px left bar — `{colors.primary-selected}` added, `{colors.ink-muted}` removed. When either appears, see EXPERIENCE.md § Component Patterns › brief-rail. → Composition reference: `mockups/key-report-workspace-brief-rail.html`. Spine wins on conflict.
- **brief-entry** — One row: entry text in `{typography.body}`, an origin-chip and a source-chip trailing. A Claim Exclusion row carries its eligibility reason as a reason-chip (gray-100/gray-700, `{typography.label}` case: business risk · routine engineering · outside the claim period · not technological). In edit, the text becomes a `{colors.chrome}` field with a `{colors.primary-light}` focus ring; triggers: see EXPERIENCE.md § Component Patterns › brief-entry.
- **origin-chip** — Pill, `{typography.label}` case. *derived* gray-100/gray-700; *writer* primary-wash/primary-selected; *edited* chrome/ink-secondary. Always text, never icon-only.
- **source-chip** — The existing chat Source primitive: `{colors.chrome}` pill with a passage reference ("T1 §14"); hover `{colors.primary-wash}`; opens the passage in a popover.
- **storyline-question** — Callout at the top of the Brief: `{colors.gap-bg}` fill, `{colors.gap-text}` text, no border, `{rounded.md}`. Two columns: the Storyline claim and the section's evidence, each with source-chips. Two actions: "Use the section's evidence" (primary-selected fill, white text) and "Keep the Storyline" (ghost).
- **compliance-line** — One line under the section-end marker: `{typography.data}` in `{colors.ink-muted}`, e.g. "Compliance · 5 applied · 1 not applied", with a Disclosure chevron. Expanded: a `{colors.gray-50}` well listing each instruction as a hairline row — instruction text in body, outcome as a status-pill chosen per tier (mapping: EXPERIENCE.md § Component Patterns › compliance-line), reason in body. A section with no relevant instruction reads "Compliance · no profile instructions for this section". → Composition reference: `mockups/key-editor-compliance-line.html`. Spine wins on conflict.
- **compliance-section** — Inside QAScorePanel, after the per-section scores: a `{colors.gray-50}` band per section with the same rows as the expanded compliance-line.
- **inventory-checklist** — A `.card` artifact in chat. Two `{colors.gray-50}` group bands, "Rule" and "Content". Each row: checkbox, `{typography.data}` locator ("244 ¶3"), body text naming the rule or instruction. A trailing "Add a correction" ghost row opens an inline field. One primary action at the foot: "Bring all N into alignment" in `{colors.primary-selected}`.
- **completion-row** — Inside the Coordinated Revision card, above the diff: hairline-ruled rows, locator in data, a status-pill, the reason in body; conflicting rows carry a second line. → Composition reference: `mockups/key-chat-coordinated-revision.html`. Spine wins on conflict.
- **status-pill-resolved**, **status-pill-blocked**, **status-pill-conflicting**, **status-pill-applied** — `{rounded.full}` pills, `{typography.label}` case, tokens per Colors (resolved primary-wash/primary-selected; blocked gap-bg/gap-text; conflicting gray-100/gray-700; applied surface with a line border and ink-muted text). The word is always present.
- **missing-facts-reply** — A plain assistant message: one body sentence, then a numbered list of the facts the draft lacks, each phrased as a question for the client, list markers in `{colors.ink-muted}`; one ghost action "Copy questions for the client" in `{colors.primary-selected}`. No card, no pill.
- **reference-pd-mark** — On a Previous PD row (New project CategoryRow or FilesPanel): a bits-ui Checkbox "Use as my reference PD" with the `{colors.primary-light}` focus ring; when checked the row carries a primary-wash/primary-selected chip "reference". The chat Suggestion "Compare to my reference PD" uses the existing Suggestion primitive.
- **comparisons-form** *(spine-only)* — On the existing admin chrome: a `.card` form of existing Input, SelectInput and Checkbox fields (project, Banhall model, baseline product and model, judge, preference, Deviation counts and method, Corrections-to-acceptable, development flag, date), one primary "Record" button; below it a table with a `{colors.gray-50}` header band, hairline rows, numbers in `{typography.data}`.
- **storyline-slot** — A CategoryRow on the New project page: `{typography.label}` "Your storyline" with the "Highest" weight pill (primary-wash/primary-selected), a plain textarea (surface, line border, primary-light focus ring), help text in `{colors.ink-muted}`.
- **save-settings-banner** — A `{colors.primary-wash}` strip inside the Inputs band, `{rounded.md}`: one sentence in ink-secondary, a secondary outlined button "Save to your Writer Profile", a dismiss IconAction. Never a modal.
- **inclusion-row** — In the Inputs band: document name in body, status word in `{typography.data}` right-aligned — *included* primary-selected, *condensed* gap-text, *not included* ink-muted. The band header carries "N of M documents in context · cap N".
- **generation-section-row** — In GenerationProgress: sections in Build Order, name in body, state in `{typography.data}` (queued · drafting · checking · shown); the active row carries a 2px `{colors.primary}` left marker. Below the list, a secondary "Stop after this section" button.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Put the Brief in the rail, beside the report | Open the Brief as a modal or a gate before generation |
| One lagoon action per surface | A second filled button anywhere on the rail or card |
| `primary-selected` for lagoon-meaning text on white | `primary` or `primary-light` text on white |
| Reuse the `[GAP:]` pair for blocked and condensed | Invent an amber, a warning yellow, or a new status hue |
| Status pills always carry the word | Colour-only dots for resolved / blocked / conflicting |
| Compliance as a line under the section-end marker | Compliance badges, highlights or margin notes inside the prose |
| Quiet applied pills; blocked and conflicting pills by tier | A fourth or fifth status colour for Compliance outcomes |
| Counts in Geist Mono, entries in Geist body | Anything above weight 500; bold for emphasis |
| Bands and hairlines to structure the rail | Cards inside the rail, boxes inside cards |
