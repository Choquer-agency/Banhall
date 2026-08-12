# Banhall design system — "Ledger paper"

Canonical tokens: `src/routes/layout.css` (`@theme` + `@utility`). Live render:
`/styleguide`. Established 2026-07-02.

**Concept.** Banhall's material is the CRA form — ruled lines, line numbers,
disciplined prose. The system reads as a calm ledger: a pale-teal working
surface with near-invisible ruled lines, content on solid white cards, one
deep-fir app bar, and a single lagoon accent. Quiet everywhere, loud once.

## Color

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#F9FCFB` | App background — carries the ledger rules; never a content bg |
| `chrome` | `#EAF2F1` | Recessed UI: wells, hover fills, pills |
| `navy` (fir) | `#0A3A38` | App bar, brand emphasis, focus rings |
| `primary` (lagoon) | `#0DACA5` | The accent: primary actions, links, active states |
| `primary-dark` | `#0A8A84` | Action hover/pressed |
| `primary-selected` | `#087A75` | Selected lagoon controls — supports white text |
| `primary-light` | `#45CFC9` | Accent on dark surfaces only |
| `primary-wash` | `#F1FAF9` | Interactive hover fill on light surfaces |
| `gap-bg` / `gap-text` | `#FEF3C7` / `#92400E` | Report [GAP:] highlights only |

**Neutral ramp** — Tailwind's `gray-*` is *remapped* to teal-cast values so
every neutral in the app shares the brand hue. Hierarchy:

- `gray-900/800` — ink (headings, primary text)
- `gray-700/600` — secondary text
- `gray-500` — muted (captions, meta)
- `gray-400` — faint (placeholders, inactive icons)
- `gray-300` — disabled
- `gray-200/100` — borders / hairlines
- `gray-50` — wash fills

Semantic aliases for new code: `ink`, `ink-secondary`, `ink-muted`,
`ink-faint`, `line`, `line-soft`.

Workflow stage badges are the only primary project-state badges on stage-aware
surfaces. Stage tones use text labels plus color: intake/interview complete=gray,
drafting=blue, internal review/revisions=amber, client review=purple,
ready/delivered=primary, on hold/abandoned=muted gray. Generation activity is a
separately labelled secondary chip and never controls the project card theme.

The legacy `Badge` palette remains compatibility-only for records without a
workflow stage: draft=gray, generating=blue, review=amber, client_review=red,
final=primary. Errors/destructive=red-500/600.

## Type

Faces: **Geist** (UI — default sans since 2026-08-10, replacing DM Sans), **Georgia** (report prose only), **Geist Mono**
(data). Roles — use these before ad-hoc sizes:

| Utility | Spec | Use |
|---|---|---|
| `.text-display` | 24/1.25 · 700 · -0.02em · ink | Page titles |
| `.text-title` | 17/1.35 · 600 · ink | Card/section titles |
| `.text-body` | 14/1.55 · 400 · ink-secondary | Default copy |
| `.text-label` | 11 · 600 · caps · +0.08em · ink-muted | Eyebrows, column headers |
| `.text-data` | 12 · mono · tabular-nums | Numbers, ids, dates, scores |

Supporting sizes stay Tailwind (`text-xs`/`text-sm`); arbitrary `text-[Npx]`
values are legacy — replace on touch.

## Surfaces & structure

- `.card` — white, `border-line`, `rounded-xl`. All content sits on cards.
- Body carries the **ledger rule** texture (1px fir at 3.2% every 2rem).
- **AppNav** (`$lib/components/ui/AppNav.svelte`) is the standard-page nav:
  full-width fir bar, logo→Dashboard + breadcrumb trail, actions right, and
  the **baseline rule** (`.nav-baseline`, teal fading right) as its signature.
  The flagged dashboard workspace is the **light bounded workspace** (below)
  and collapses its rail before it can squeeze operational content.
  Only the report workspace (`project/[id]`) keeps a custom dense header.
- **Report column**: anywhere a report renders (editor, candidate preview,
  history) uses `max-w-report` (`--container-report`, 1080px) — one knob.
- **Global rail**: AppNav + PageBar inner containers are ALWAYS `max-w-7xl`
  (never per-page). Page `<main>` may be narrower for reading width
  (`max-w-3xl/4xl`), centered inside the same gutters; `px-6 pt-12`.
- **PageBar leading controls**: one stable, 44px-tall page-scoped disclosure may
  sit beside Back. Use it for reference details that must remain accessible
  without creating another permanent page row; content opens in a portaled,
  collision-aware popover. Do not repeat a state already shown in AppNav or
  reserve space for optional empty fields.

## Light bounded workspace (2026-08-06)

The flagged dashboard workspace (`WorkspaceDashboard` on `/my-work` and
`/projects`) presents a **pure-white working plane inside a fir-railed,
viewport-bounded shell** — redesigned 2026-08-06 off the earlier dark plane
after the recorded baseline audit (dark canvas + low-alpha surfaces produced
sparse, tiring hierarchy; the fir rail was never the problem):

- **Plane.** `[data-workspace-theme="light"]` in `layout.css` retints only
  `canvas` to `#FFFFFF` for the subtree; every other token inherits base
  Ledger Paper values. The opaque shell root keeps the body's ledger-rule
  texture OUT of the bounded workspace — the workspace is a work surface,
  not a document page. This plane is deliberately whiter than the standard
  Ledger canvas (`#F9FCFB`).
- **Fir rail/drawer unchanged.** `--color-shell` is theme-independent by
  construction; every `white/N` class there sits on fir. The navigation
  drawer and rail-anchored portaled menus keep the dark scope (fir surface,
  white text); content-anchored menus render as white cards.
- **Structure comes from bands + hairlines, not boxes.** Group/section
  headers are full-width `gray-50` bands; rows separate with `line-soft`
  hairlines; recessed controls use `chrome`. No box-in-box framing.
- **Cards are single white surfaces** (`bg-surface`, `border-line`, 12px
  radius, up to 2-line title, client supporting line, compact owner/date
  footer). Stage colour lives in the labelled light stage badge (`badge`/
  `dot` in `stagePresentation.ts`) on column headers and rows — never a
  card tint; paused work keeps the dashed border cue. Hover and keyboard
  `focus-within` answer with the same border + soft shadow.
- **AA pairs on white.** Lagoon `primary` under 13px white or fir text
  measures < 4.5:1, so primary actions on the plane use
  `bg-primary-selected text-white` (`#087A75`, minted for this). Links and
  title hovers use `primary-selected` — never `primary-light` on white
  (`#45CFC9` ≈ 1.9:1). Overdue red (`red-700`) remains the strongest
  semantic colour in any row.
- **Rollback seam.** Restoring `data-workspace-theme="dark"` on the shell
  root re-mounts the recorded dark treatment wholesale; the dark scope CSS
  and the `charcoal*`/`STAGE_CARD_CHARCOAL_THEMES` tiers stay in the
  codebase for that purpose (and for the surfaces below).

## Dark workspace exception (scoped, 2026-08-06; dashboard moved to the light workspace above the same day)

The remaining dark-scope surfaces (`WorkspaceChrome` on the adopted utility
pages, the workspace navigation drawer and rail-anchored menus, and the
preview branch of the report route) keep the recorded departure
from Ledger Paper: an **Obvious-dark shell with a Banhall identity** — a
near-black content plane (`#161717`) with a **branded fir navigation
rail/drawer** (`--color-shell: #0A3A38`, hairline `--color-shell-line:
#114b48` — updated 2026-08-06; the earlier charcoal `#1B1D1D` rail copied
Obvious's monochrome material and conflicted with PRODUCT.md's "fir
navigation surface" Brand Commitment), low-alpha boundaries, compact dark
cards (~12px radii, no shadows), and calm high-fidelity density. It is
implemented as the `[data-workspace-theme="dark"]` scope in `layout.css`,
which retints the semantic tokens (`canvas`, `surface`, `chrome`, `ink*`,
`line*`, `primary-wash`, `primary-selected`, dark-legible reds) for that
subtree only. Portaled surfaces opened from the workspace (menus, the
navigation drawer) re-declare the attribute to stay in scope.

**Rail contrast, measured (2026-08-06, WCAG relative luminance):** white on
fir 12.5:1; idle rows `white/65` 6.2:1 (≥4.5 AA); focus outline
`primary-light #45CFC9` 6.6:1 (≥3 non-text). Lagoon `#0DACA5` text on fir
measures **4.45:1 (< 4.5)**, so the selection row is a quiet white capsule
(`bg-white/10 text-white`), never lagoon-tinted text. The wordmark renders
white-on-fir via `brightness-0 invert` — the established AppNav treatment;
the un-inverted logo was evaluated 2026-08-06 and rejected because its navy
strokes (eyes, "consulting inc") vanish against fir.

**Scrollable utility chrome.** The same flagged experience may wrap `/settings`,
`/alerts`, `/requests`, and `/changelog` with `WorkspaceChrome`. It reuses the fir
rail/drawer and a plain title header with no decorative side rule, but its main
content is a normal `overflow-y-auto` document surface rather than the board's
horizontal/per-lane containment chain. Content inside this scope must use
semantic surface/text tokens (`surface`, `ink*`, `line*`); the current
AppNav/PageBar subtree remains available through `?workspace=current`. Project
creation, admin, public review, print, and export surfaces are not implied by
this exception. The report route is separately gated: its committed dense
report workspace remains the current subtree, and the reviewed Agent-left/
report-right workbench is the preview subtree. The route shows a neutral loading
surface while the rollout decision is pending rather than mounting either
query-heavy report composition. Both preserve report primacy and share the same
domain/data behavior.

**Banhall accents inherit — they do not invert.**

- **Lagoon** stays the single accent: keyboard focus (`primary-light`
  outline), hover washes, and the primary action. The header's decorative
  left title tick was **removed 2026-08-06** — the title stands alone.
- **Fir** carries the navigation shell and stays on identity/avatar surfaces
  via the fixed `--color-fir` token, which never theme-flips (avatars, owner
  discs, handoff chips).
- **Canonical stage tones keep their hue** as low-alpha charcoal chips —
  `charcoalBadge`/`charcoalDot` in `stagePresentation.ts` (neutral gray,
  drafting blue, internal review/revisions amber, client review purple,
  ready/delivered lagoon, paused muted gray + dashed). Text labels always
  accompany color. (Since the light-workspace move, the dashboard board
  uses the light `badge`/`dot` tier; the charcoal tier remains recorded for
  the dark-scope surfaces and the retheme rollback.)

### Projects Board — artifact-board anatomy (2026-08-06; light-plane card update the same day)

The Projects Board's visual authority is the **Obvious artifact Kanban** —
the embedded board artifact inside the project workbench
(`app.obvious.ai/p/…/…-board-…`), NOT the `/projects` dashboard listing.
Recorded anatomy (from the authenticated artifact DOM):

- **Viewport containment**: the workspace shell (`WorkspaceDashboard`) is
  viewport-bounded — `h-dvh` root with a single pinned grid row
  (`grid-rows-[minmax(0,1fr)]`) and an unbroken
  `min-h-0`/`flex-1`/`overflow-hidden` chain down through `main` and
  `ProjectsTableView`. The page itself never scrolls; each view owns its
  scroll (Board horizontally, List and My Work in their own
  `overflow-y-auto` regions) and no brittle `calc()` viewport heights exist
  anywhere in the chain.
- **Scroll plane**: horizontal scroll only at the outer level (vertical
  hidden), hidden scrollbar (`scrollbar-hidden` utility in `layout.css`),
  `snap-x`, `px-2 pb-4`; track is `flex gap-2 items-stretch w-max pr-4`,
  full height. The track carries **no min-height floor** (a floor would
  force taller-than-region columns and clip cards on short viewports).
- **Columns**: fixed **360px**, `shrink-0`, full height in the stage-first
  and focused boards (natural height inside client lanes), **same-tone
  containers** — column fill equals the canvas token (white on the light
  workspace plane; originally measured on Obvious's `#161717` plane, and
  Notion's light board is the white-plane co-evidence), structural
  `rounded-xl` retained, border-none/shadow-none, never a contrast well or
  tint (the "bare column" effect is same-tone material, not absent
  structure).
  Column identity = header pill + position + gutter. Header is
  `px-2 py-2`: the compact 12px stage pill (light StageBadge) + mono
  count. Column bodies scroll vertically and **independently** with hidden
  scrollbars, `p-2 pt-0`, cards spaced 12px — per-column scroll is the
  artifact's core behavior; column headers never scroll away. Below `md`
  (corrected 2026-08-07; supersedes the next-lane card-body peek, which
  live QA read as broken clipping) the visible stage takes the board's full
  usable width (`100cqw` against the `@container` scroll region) so
  adjacent card BODIES are masked; horizontal continuation is carried by a
  deliberate decorative right-edge canvas fade (`aria-hidden`,
  `pointer-events-none`, scroll-driven so it fades out at the track end and
  never shows on a board without horizontal overflow where supported) and,
  on the focused board, the explicit "Stage N of M" selector. From `md` up
  columns stay exactly 360px.
- **Task cards** (light single-surface anatomy, 2026-08-06): ONE white
  `bg-surface` card with a `border-line` hairline, 12px radius, `p-3` — the
  earlier dark-theme two-layer card (stage-tinted shell + inset neutral
  panel) is retired; on white it read as packaging, not content. Title is a
  2-line clamp at 14px medium; the client name is a muted supporting line
  directly beneath (no per-field icons — Linear/Notion/GitHub co-evidence)
  — suppressed via `showClient={false}` on client-scoped surfaces (client
  lanes, the focused board) whose section/board header already names the
  client (2026-08-07; repeating it on every card was noise), and kept on
  the flat stage-first board where the card is the only client signal;
  conditional chips (AI activity on `chrome`, legacy qualifier) sit on one
  row; the footer is a compact fir owner disc + owner label + mono updated
  date. Hover and keyboard `focus-within` share the `gray-300` border +
  soft shadow affordance; paused cards keep the dashed border. Stage colour
  stays in the labelled header badge, never a card tint. The **whole card
  is the navigation target**: the title anchor carries a stretched `::after` over the
  `relative` article (≥44px touch target per the product-domain contract)
  while the visible link and focus ring stay on the title row. Any nested
  interactive element added to a card later must be `relative z-10` to sit
  above the stretched layer.
- **Every canonical stage renders by default** (amended 2026-08-06, second
  amendment): all ten stages in `WORKFLOW_STAGE_PIPELINE_ORDER` — corrected
  2026-08-06 to the canonical stage-table sequence `… ready_for_delivery →
  delivered → on_hold → abandoned` (delivery completes the pipeline;
  paused/terminal exceptions follow) — full width, zero-count included —
  never collapsed rails. Only the qualified `Legacy status` compatibility
  column is conditional (renders only while legacy rows/counts exist).
  Empty columns render the header only (plus the intake-only creation
  footer where defined) — no empty-state body box, message, or
  minimum-height placeholder (Obvious + Linear-dark co-evidence). The
  bounded-scan truth lives entirely in the header: `0`, `N+` when bounded,
  and the "none loaded yet" subtext on facet-vs-loaded disagreement. All
  ten stages remain the default; the persisted "Hide empty stages" display
  option may collapse facet-count-zero stages with a visible, focusable
  "N empty stages hidden — show" disclosure. Column headers are focusable
  and labelled (`«Stage», N projects`) so the column track is
  keyboard-traversable; cards answer keyboard `focus-within` with the same
  border affordance as hover. (Historical: charcoal chip contrast on
  `#161717`, measured 2026-08-06 — labels 6.9:1 – 10.2:1, dots 3.8:1 – 10:1
  — applies wherever the charcoal tier still renders on dark surfaces.)
- **Not copied from Obvious** (workbench/artifact-specific): column
  drag/rename, card drag-and-drop, and the 44px artifact title/actions
  header. Banhall's board stays read-only — canonical stage columns plus
  the qualified Legacy status column, truthful Owner/AI-activity/updated/
  legacy fields, List one click away. Creation affordances are
  navigation-only (second amendment 2026-08-06): a quiet `+ New project`
  footer on the intake column and client-scoped `+ New project` links on
  client lane/section headers (both open the creation wizard; the client
  link carries an editable recorded-name prefill). Column drag/rename and
  card drag-and-drop remain not copied.
> **Superseded 2026-08-12** (see product-domain amendment): Focus mode is
> removed — lanes render ALL loaded projects as one horizontal snap card
> row with an in-place "+N more"; the inline hidden-stages disclosure is
> retired on every surface. The lane/Focus bullets below are historical.

- **Client lanes (`group=client` board mode)** (2026-08-06, second
  amendment; corrected same date post-review): vertical stack of
  collapsible client sections (A–Z, paginated), each an independent
  horizontal snap row of same-tone stage columns at the governed **360px**
  width, filtered by VERIFIED exact per-client `stageCounts`
  (sum === projectCount; anything else fails honest). Lane columns take
  natural height but preview at most **three** cards each; the truthful
  remainder renders as a "Show N more in Focus" link into the focused
  board — never an inner vertical scroller, never a viewport-tall stack.
  Collapsed lanes are single header rows with counts and hold zero
  subscriptions; at most **six** sections stay open (live) at once, with a
  bounded, honestly labelled "Expand first 6" control. Grouped mode uses a
  `WorkspaceChrome`-style outer vertical scroll owner with no per-column
  vertical scroll; below `md` the grouped board presents as the grouped
  List (with an explicit "Board grouping uses the list layout on small
  screens" status so the pressed Board control never contradicts what
  renders — 2026-08-07) and the focused board presents one full-width
  column at a time with the right-edge fade cue PLUS an explicit
  "Stage N of M" indicator and an accessible stage selector (scroll/focus
  navigation only, no mutation).
  Blank recorded names present as the conditional "No client recorded"
  section (no creation prefill). The recorded-client-name caveat renders
  on every client-grouped surface, and the client-scoped `+ New project`
  action stays reachable at every viewport (compact "+ New" below `sm`,
  44px target; below `sm` the + New / Focus links move to a second header
  action row so the client name wins the full first line — 2026-08-07).
  Pre-backfill, the client hide-empty switch presents
  disabled with "Available after client counts finish backfilling"; a
  bounded/unknown zero count renders `0` with a "not fully loaded" note —
  never `0+`. Light-plane presentation (2026-08-06): client sections are
  **band-headed** — a full-width `gray-50` header band (label/name/count/
  New/Focus/disclosure, 44px targets) with content flush on the white plane
  beneath, closed by a `line-soft` hairline — never rounded outline boxes
  (box-in-box framing was a dark-theme necessity, not a contract).
- **My Work is queue-first** (2026-08-06, second amendment; corrected same
  date post-review): one primary due-ordered queue (Linear-density ruled
  rows) with scope chips (All / Reviews / Due soon) that swap the
  subscribed indexed query — a plain `role="group"` of `aria-pressed`
  toggle buttons (not a tablist), where only the ACTIVE scope carries its
  truthful loaded count (inactive counts would need standing subscriptions
  the budget does not spend) — plus a compact two-column accountability
  strip (Owned by me / Waiting on others) beneath. The five accountability
  meanings remain the semantic contract; the five stacked sections and the
  Board/List toggle are retired. Light-plane presentation (2026-08-06):
  section headers are `gray-50` bands; the scope group is a recessed
  `chrome` segmented control with a raised white active segment; rows are
  hairline-ruled two-line grids — line 1 = title with a REAL due date
  pinned right (overdue `red-700` semibold stays the row's loudest colour;
  an ABSENT due date renders as muted line-2 metadata — "No due date" /
  "Due not set" — and never steals first-line title width, 2026-08-07),
  line 2 = labelled light stage badge, review/handoff chips, kind · client
  (visible at every width), with assignee and quiet visible actions pinned
  right (Complete = secondary, Reassign = ghost; the page's single loud
  lagoon element is the header's New project). The same grid resolves
  Title → Due → context → assignee at 390px; the accountability strip keeps
  its count-preserving mobile disclosures, EXCEPT that a non-empty
  "Owned by me" defaults open at every viewport (2026-08-07 — the daily
  destination must never hide its only responsibilities; manual toggles
  still win). Persistent helper/provenance/qualifier text renders at the
  `ink-secondary`/`ink-muted` tiers — `ink-faint` (≈2.6:1 on white) is
  reserved for placeholders and disabled labels.
- The saturated fir app bar keeps the opaque `darkBadge` treatment — the
  charcoal chips are exclusively for the dark-scope surfaces.

### 2026-08-08 amendment — stage-toned cards, Home presentation, rail ergonomics, shared disclosure

Product-owner-approved (2026-08-08 workspace-overhaul request; presentation
only — the product-domain amendment of the same date records that no domain
semantics change). Evidence: recorded Mobbin research (Featurebase roadmap,
Notion team board, Twenty companies board, Stripe/Databricks rail behavior,
Featurebase/Customer.io accordions, Zoho/Squarespace/Stripe Home), prior
recorded Obvious evidence, and the supplied sprint-board screenshot. No new
live Obvious evidence (Chrome control unavailable).

- **Stage-toned board cards (bounded exception to the card-tint rule).** The
  Projects-board card is now visually related to its stage through the
  canonical light tier `STAGE_CARD_THEMES` in `stagePresentation.ts`: the
  stage-toned hairline **border** (paused keeps the dashed cue) and a subtly
  tinted **footer band** (`footerBg`/`footerText`) carrying Owner + mono
  Created/Updated stamps. The card **body stays a white `bg-surface`
  panel — a full-card tint remains prohibited** — and the labelled stage
  badge/dot stays the primary text+colour signal, so colour is never the
  sole status channel. This supersedes the earlier "stage colour … never a
  card tint" clause only to the extent of this bounded border+band
  adaptation; hover and keyboard `focus-within` use the same stage-toned
  border + soft shadow pair. All tone pairs stay AA on their tinted bands;
  no ad-hoc hex enters components.
- **Home presentation.** `/my-work` presents as **Home** (rail + header
  label; canonical URL unchanged): a restrained time-of-day greeting, the
  start-project intake, and optional device-local recents. The Loaded now,
  Next actions, Owned by me, and Waiting on others regions do not render on
  Home, and their subscriptions are not kept live invisibly.
- **Resizable / hidable workspace rail.** The desktop fir rail resizes by
  pointer drag and keyboard (`WorkspaceRailResizeHandle`: WAI-ARIA
  window-splitter `role="separator"` with truthful `aria-value*`; arrows ±8,
  Shift ±32, Home/End to min/max; 8px hit target over a visible 1px edge;
  pointer capture, `cursor: col-resize`, `user-select: none`, transitions
  suspended during drag via direct CSS-custom-property writes — no per-move
  re-render). Bounds 220 / 255 / 360; width + hidden persist via
  `railPreferences.ts` (fail-closed). Hide/show is a ≥300ms
  grid-template-columns transition (restrained ease-out, reduced-motion
  instant). The expanded rail owns its collapse control in the identity row,
  matching the Obvious placement; once hidden, a restore control appears in
  the content header so the action remains reachable. Showing restores the
  prior expanded width; the hidden rail is `inert`. The mobile drawer is
  independent and unchanged.
- **Shared disclosure motion (rule 8 made concrete).** `ui/Disclosure.svelte`
  is the sanctioned animated disclosure body: grid-template-rows 0fr↔1fr
  enter **and** exit ≥300ms (the approved intrinsic-height technique; no
  width/height animation), reduced-motion instant, collapsed body `inert`
  (not tabbable, hidden from AT) while staying mounted so the exit has
  content to collapse. Hosts keep the trigger (`aria-expanded` +
  `aria-controls`) and use `ui/DisclosureChevron.svelte` for the rule-7
  chevron — a chevron must never animate while its content snaps. Adopted by
  MyWorkGroup, ProjectsClientGroup, and the workspace header's mobile search
  reveal; the global bits-ui 300ms scale/fade enter/exit for dropdowns,
  selects, tooltips, and dialogs is verified and preserved. No decorative
  perpetual animation anywhere.

Everything outside the scope — every standard page and the
`?workspace=current` escape — remains Ledger Paper. Product-domain semantics
(canonical stage columns, Owner/current-handoff/Creator distinctions,
no drag-to-transition) are unchanged by the theme.

### 2026-08-08 amendment (second) — Authenticated Obvious parity: Home composition boundary and Preview project intake workbench

Product-owner-approved close structural translation of the AUTHENTICATED
live Obvious evidence (direct desktop audit at 2560×1266, recorded
2026-08-07/08: Obvious Home — dark #171717 shell, 208px sidebar, ~1202px
max content sections, recent-project cards, restrained vertical clustering;
Obvious project — 44px global + 48px artifact bars, persistent left
conversation pane beside the active artifact, resizable separator with
observed chat widths ~409/~657px, independent pane scrolling). Structure,
spacing, density, and interaction anatomy are translated onto Banhall
tokens and Banhall truth; no Obvious trademark, asset, copy, or
accessibility defect is copied.

- **Home content boundary.** Home's scrollable content (greeting, intake,
  and optional recents) centers inside a `--container-shell` (72rem)
  boundary — the existing shell token, closest
  to Obvious's ~1202px section width — so ultrawide viewports read as a
  deliberately clustered composition instead of a ~2300px stretch. The
  scroll owner stays full width (scrollbar at the viewport edge). Projects
  (dense repository/board) is exempt: density is its purpose.
- **Recently opened rail (Home).** A horizontal snap-scroll band of quiet
  white cards (`border-line`, 12px radius, 2-line title clamp, ≥44px
  targets) fed EXCLUSIVELY by the browser-local `recentProjects` list the
  workspace rail already owns — no queries, no server pins, no invented
  metadata, and NOTHING renders when no recents exist. Labelled "Recently
  opened · on this device" so provenance stays honest. Obvious's artifact
  shortcut chips, idea-template carousel, pinned apps, and freeform AI
  composer are deliberately NOT copied (unsupported semantics).
- **Preview project workbench header.** The preview report route keeps the
  two-band dense header (fir AppNav ≈54px + PageBar 44px, Obvious's
  44px + 48px anatomy); the PageBar now carries the route's SINGLE `h1`
  project title beside the workflow control (sr-only below `sm`), and the
  in-body editable title renders at heading level 2.
- **Intake workbench (no-report state).** At `lg`+ the no-report state is a
  split workbench mirroring the report state's anatomy: persistent left
  CONTEXT pane (files evidence + interview transcript) beside the primary
  intake/generation work surface (metadata, review feedback, generation
  controls), independent `overflow-y-auto` panes inside the `h-dvh`
  containment (no document scroll; the ~27k-px transcript no longer owns
  page height), and a keyboard-operable resizable separator with the
  assistant rail's clamps (24–55%) persisted under its own key
  (`banhall_intake_context_ratio`). Below `lg`: explicit Work/Context
  `aria-pressed` switches, one pane visible at a time, ≥44px targets. The
  state remains honest: no chat, composer, or report is implied.
- **Accessibility corrections shipped with this amendment** (from the same
  authenticated audit): heading names are the titles themselves with edit
  controls as adjacent siblings (`EditableText`); the Files panel is a real
  disclosure (`aria-expanded`/`aria-controls` + shared `Disclosure` body);
  the rail's Home row no longer nests a link inside a focusable tooltip
  wrapper; the AppNav logo focus stop owns the bar's height (never
  zero-height); the Board/List view toggle keeps every control in the tab
  sequence (group of `aria-pressed` buttons, no roving tabindex). Obvious's
  own defects (unlabeled buttons, missing landmarks, positive tabindex,
  color-only state, tiny targets) remain non-goals.

### 2026-08-10 amendment — Home start-project composition

Product-owner-approved translation of the supplied Customer.io Agent and
Obvious Home references. `/my-work` may lead with a large, calm, centered
start-project composer inside the existing light bounded workspace. It is
**not an AI assistant or generation surface**: the labelled textarea and
`Start project` action only open the existing `/project/new` wizard and carry
a short, editable internal-title prefill through a one-use in-memory handoff.
Nothing is created, generated, uploaded, or persisted from Home.

The first composition is a centered, approximately 644px start cluster within
the wider Home workspace: a centered time-aware greeting and one sentence
naming the task, followed by left-aligned ledger inputs for the internal project
title and optional interview transcript. A restrained, token-derived fir/lagoon
radial wash may sit behind this opening cluster; it stays decorative,
noninteractive, and substantially quieter than the rest of Home. Optional
recents return to the wider left-aligned Home boundary beneath it. Writers may
paste transcript text or attach/drop a Teams Word
`.docx`; parsing remains browser-local, and `Start project` carries the editable
title plus extracted transcript text into the existing wizard. The Home form uses one quiet, slightly rounded white intake box with a single
soft hairline and no shadow. It has no suggestion bubbles, artifact chips,
templates, chat messages, send iconography, or thinking state. Native input
hover/focus decoration is suppressed inside this box so the stable ledger
underlines do not recolor or gain a second focus ring. Because project intake
is already the primary Home composition, Home omits duplicate `New project`
actions from both the workspace header and navigation rail; Projects retains
them.

Device-local recents may use a horizontally scrollable, snap-aligned project
row with a truthful `View all projects` destination and a quiet overflow fade;
it must not invent thumbnails, timestamps, collaborators, server pins, or
artifact previews. Loaded work insights, Next actions, Owned by me, and
Waiting on others are intentionally absent from Home. On this Home surface the mono family
is confined to numeric values and numeric bound markers; all labels, dates,
qualifiers, shortcuts, and prose remain the default sans (Geist). Mobile targets remain at least
44px.

### 2026-08-12 amendment — client lanes render the standard board; Focus and inline hidden-stages disclosures retired

Owner direction (recorded in the product-domain amendment of the same date;
presentation only). Supersedes the matching clauses of the 2026-08-06
client-lane anatomy above:

- **Client lanes = the standard stage-column board per client.** Each
  expanded `group=client` lane renders the shared `ProjectsBoard` (same-tone
  columns, tinted-shell cards with the client line suppressed, horizontal
  snap scroll + edge cue, per-column "+ Add new" footers with the client's
  recorded-name prefill) scoped to that client's rows and verified
  `stageCounts`. Columns take natural height inside the grouped board's
  outer vertical scroller. The three-card preview, the "Show N more in
  Focus" link, the focused single-client board, and the `?client=` board
  param are retired; a bounded server page ends with an in-place "+N more"
  load-more.
- **Inline "N empty stages hidden — Show" disclosures are retired on all
  surfaces** (stage-first board and client-grouped list): hidden empty
  stages simply do not render; the Display menu's persisted hide-empty
  switch is the only reveal control. Truth criteria unchanged.
- **Section band tightened.** Client band headers keep the gray-50 band
  grammar with no radius on the band, name at `font-medium`, the count in
  the `.text-data` role, and the quick-create as a quiet opacity-only text
  action. The grouping chip reads as a labeled control ("Group" off,
  faint "Group ·" + ink "Client" on) with bare "None"/"Client" options
  under the "Group by" heading.

## Panel motion (2026-08-10)

Floating panels animate with a shadcn-style **pop** (owner direction,
2026-08-10), implemented as Svelte custom transitions in
`src/lib/motion/panelMotion.ts` layered on bits-ui primitives (which keep
positioning, focus, and aria behavior):

- **Pop** (`popIn`/`popOut`): fade + zoom from 95% + an 8px slide, with the
  transform origin at the corner nearest the anchor. Pure CSS transform, so
  the panel's `shadow-md` box-shadow scales with it and appears immediately
  (a clip-path morph delays the shadow — the reason drop-shadow variants
  were retired). 150ms in / 120ms out. Used by the board Filters popover,
  `ui/GhostPopover`, and the projects Display menu; the GhostPopover chevron
  flips with a springy overshoot.
- Alternates `morphIn`/`morphOut` (single-surface clip morph),
  `gooIn`/`gooOut` (liquid ooze through an SVG goo filter), and
  `unfoldIn`/`unfoldOut` (bouncy unfold with staggered items) remain in the
  module but are not currently applied.

Panels share `rounded-xl border border-line bg-surface shadow-md`. Every
variant falls back to a 120ms fade under `prefers-reduced-motion`. New
floating surfaces should adopt `popIn`/`popOut` rather than inventing new
motion.

The board Filters popover is compact: 13px option rows, a small faint
"Filter by" label above the list (suffixed with the active field, e.g.
"Filter by Stage", when a field is selected), and the active filter chip's
"equals" operator segment reads in the faint ink tier. Picking a field
plants a condition chip with a faint "Select…" placeholder that filters
nothing and persists until its value is chosen or its × removes it — the
value list is never auto-opened; clicking the chip's value segment opens
the popover anchored to that segment. Applied stage values wear the stage's
canonical label tint on the chip's value segment (legacy stays neutral).
Multiple conditions join with a quiet faint "AND" label, and the add-filter
"+" is a dashed faint-grey square (slightly darker on hover) that opens the
fields list anchored to itself.

The grouping control is `ui/GhostPopover` — the reusable chip-triggered
single-select popover sharing the Filters-popover panel anatomy (small faint
heading like "Group by", compact 13px rounded-md options, active option on
the chrome wash). It lives in the right control cluster beside
Filters/Display (2026-08-10) with `align="end"` so its panel opens leftward
and stays on-screen near the viewport edge. New chip-triggered single
choices should reuse `ui/GhostPopover` (the former bits-Select GhostSelect
wrapper is retired).
Picking a field renders the condition chip immediately with a faint
"Select…" placeholder value, and the value popover opens anchored to that
chip's value segment (bits `customAnchor`) — not to the Filters button.
Stage values render as their canonical stage-tone badges with faint
right-aligned counts; closing without picking a value removes the
placeholder chip.

## Workspace-shell adoption — wizard + report workspace (2026-08-10)

Owner direction, from live study of Obvious.ai's project workspace: both
`/project/new` and the preview-cohort report route now live in the **light
workspace shell** (fir rail + white plane) instead of the classic dark
AppNav + PageBar ledger bands.

- `/project/new` wraps the existing wizard in `WorkspaceChrome`
  (`theme="light"`): thin header with page title, mode description, and the
  consultant chip; wizard content unchanged beneath.
- `PreviewProjectPage` replaces its two-band header (54px dark AppNav +
  44px PageBar) with `WorkspaceShell` + ONE thin project header (Obvious
  anatomy): rail/drawer controls, workflow menu, the route's single `h1`
  project title, light stage badge, and generation chip on the left; save
  state and the ghost icon actions (share, compare, history, maximize,
  export, financial) on the right. All generation states share this header.
  The frozen `CurrentProjectPage` keeps the classic chrome (rollback seam).
- `WorkspaceChrome`'s header title is `font-medium` (max-weight-500 rule).

Workbench density (2026-08-10, Obvious doc-artifact study): the agent
composer is a white bordered rounded-2xl box in the Obvious two-row anatomy —
textarea on top ("What should we work on?"), action row beneath with attach
left and the round navy send right — pinned to the pane bottom in every
state including the empty thread. The chat header, empty state, and starter
suggestions are compact (13px scale, medium weights). The right pane's
project metadata heading is `text-xl font-medium` (EditableText
`headingClass` override; `text-display` stays the default elsewhere), the
metadata grid is 13px, and the PD review score card is proportionally
smaller. The report editor itself already reads at 14px serif.

Ghost header controls (2026-08-10, measured off Obvious): every workbench
header control is a ghost — the workflow menu and the chat thread selector
("Assistant • thread ⌄", which IS the conversation menu trigger) are h-7
rounded-full pills; icon actions (assistant toggle, share, compare,
history, focus mode, export, financial) are size-7 rounded-full icon-only
buttons with `title` tooltips, `text-ink-muted` → chrome-wash hover.
Maximize is phrased "Enter/Exit focus mode" per pane, Obvious's symmetric
model. Chat messages read at 14px/1.5. The composer textarea carries
`input-chromeless` PERMANENTLY — the global unlayered
`textarea:focus-visible` fir ring (layout.css) beats Tailwind's
`outline-none`, so the chromeless class is the only sanctioned opt-out;
the composer shell owns focus affordance.

### 2026-08-07 amendment — light operational admin shell

The authenticated admin routes `/admin/usage`, `/admin/reviews`,
`/admin/brain`, `/admin/models`, `/admin/tags`, `/admin/users`, and
`/admin/backfill` use `AdminWorkspacePage` over `WorkspaceChrome`:

- The fir rail/drawer keeps the established 255px default desktop width,
  resizable persistence, canonical Home (`/my-work`) and Projects
  (`/projects`) links, compact identity/global actions, device-local recents,
  and account/utility footer. Admin links stay exclusively in `UserMenu`.
- The admin content plane uses the light semantic-token scope, one compact
  title/action header, exactly one `main` and `h1`, and normal internal
  vertical scrolling. Route content is either the 72rem shell boundary or a
  48rem compact boundary; it never nests another `main`.
- Below 1280px the rail becomes the existing accessible modal drawer. The
  drawer's initial focus moves inside through Vaul's supported autofocus
  contract; trap, Escape, scrim, scroll lock, and focus return remain intact.
  Portaled account menus opened from the drawer use the drawer-overlay layer
  (`z-[130]`, above the drawer at `z-[110]`) and every account row is at least
  44px high.
- Admin tables own horizontal overflow inside their content cards, and dense
  multi-tab controls use a horizontally scrollable 44px-tall trigger row on
  narrow screens. The document and shell do not gain horizontal overflow.
- `?workspace=current` restores the same route content in the prior
  AppNav/PageBar presentation. This is a presentation-only rollback seam;
  queries, mutations, and authorization remain route-owned and single-copy.

Evidence: the 2026-08-07 Mobbin synthesis and the responsive Obvious/Banhall
audit under `artifacts/responsive-sidebar-audit-2026-08-07` plus the route
captures under `.artifacts/visual-route-audit-2026-08-07`. The compact
hierarchy is adopted; Obvious's missing modal semantics/focus behavior and
28px mobile controls are explicitly rejected.

1. One accent per view — lagoon marks the primary action, nothing else.
2. Text steps down the ramp, never up, within a block.
3. Numbers/ids/dates/scores render in `.text-data`.
4. New interactive primitives come from bits-ui (headless) styled with these
   tokens; stock components via `bun x shadcn-svelte add`.
5. Spacing rhythm: 2rem section gaps (matches the ledger rule), 0.75rem card
   radius, gap-3 grids.
6. Prefer semantic aliases (`text-ink-muted`) in new code; gray-* remains
   valid in ported code.
7. **Expandable rows**: disclosure chevron sits at the row's RIGHT edge,
   points DOWN closed → UP open (rotate-180), and turns `primary` when open.
   Never left of the label.
8. **Motion**: every transition runs ≥300ms (`--default-transition-duration:
   300ms` makes bare `transition-*` utilities 300ms; never use duration-75/
   100/150/200). Use restrained ease-out curves without overshoot and remove
   nonessential movement under `prefers-reduced-motion`.
9. **Hover fills** on light surfaces use `primary-wash` — never gray washes.
   Destructive hovers stay red; dark-surface hovers stay white/alpha.
10. **Form controls**: focus/hover NEVER change border width. Pointer focus
    uses animated border color; keyboard `:focus-visible` additionally uses a
    two-step canvas/fir halo so focus remains unmistakable without layout shift.
    Required fields always show a red asterisk on the label (Input component
    does this automatically from the `required` attr).
11. **Icon-only controls get a Tooltip** (shared ui/Tooltip) — launcher
    bubbles, hover actions, locate pins. Never a bare `title=`.

## Chat primitives

`$lib/components/chat/primitives` — prompt-kit-shaped chat building blocks,
implemented natively in Svelte 5 runes on these tokens (API-shape inspiration
only; no React). Specimens on `/styleguide`; composed in `AgentChatPanel`.

- `ChatContainer` — message viewport with stick-to-bottom: follows new content
  while pinned, stops when the user scrolls up, resumes at the bottom.
  `bind:this` exposes `scrollToBottom(behavior)`; `bind:isAtBottom` readable.
- `ScrollButton` — floating "jump to latest"; auto-appears via ChatContainer
  context when not at the bottom.
- `Message` / `MessageContent` / `MessageAvatar` — role-based bubbles: user =
  primary-tinted right bubble, assistant = plain left ink; `markdown` renders
  through svelte-streamdown with the `chat-markdown` styles.
- `PromptInput` (+ `PromptInputTextarea`, `PromptInputActions`) — composer
  well: autogrow textarea capped at 140px, Enter = send / Shift+Enter =
  newline, `pill` snippet + `textIndent` for the highlight chip, action slots
  either side.
- `Loader` — bouncing-dot typing indicator (`md`/`sm`).
- `Suggestion` — canned-prompt pill chip (wash hover, one accent rule applies).

- `ChainOfThought` with `ChainOfThoughtStep`, `ChainOfThoughtTrigger`,
  `ChainOfThoughtContent`, and `ChainOfThoughtItem` — prompt-kit-compatible
  compound API for collapsible public progress. Stage icons inherit `primary`;
  live research status adjusts icon opacity/colour. It never exposes provider
  names or hidden model reasoning.
- `Source` with `SourceTrigger` and `SourceContent` — linked domain chip with
  favicon plus title/excerpt detail on hover or keyboard focus. Only external
  citations render here; private project documents and Brain writing patterns
  stay out of the web-source row.
- `FeedbackBar` — helpful/not-helpful response feedback. Research responses send
  this signal through the existing admin-reviewed Brain feedback queue; feedback
  is never learned automatically.
