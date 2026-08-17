# Design QA — Attio-informed rail and Projects repository

## Comparison target

- The authenticated Attio company record and the signed-in Banhall Projects
  view were reviewed together at desktop size in the in-app browser.
- The target is Attio's compact hierarchy and interaction density, adapted to
  Banhall's light Ledger plane, existing Svelte components, semantic tokens,
  Phosphor icons, project fields, and workflow rules. No proprietary markup,
  SVG path, CRM object, or visual asset was copied.

## Visual comparison

- The rail now follows the reference's strongest structural cues: compact
  identity/search rows, quiet selected navigation, a separated records group,
  small colored admin icon tiles, and a bottom utility/account zone.
- Developer utilities no longer add a disclosure layer. They read as direct
  low-priority destinations for flagged accounts; ordinary accounts receive
  only What's new.
- Projects now has one compact toolbar. `Client`, `Display`, and the icon-only
  List/Board segmented switch share a consistent icon, height, border, and
  spacing rhythm. Tooltips and accessible names carry the hidden labels. List
  is first and remains the default.
- Filters remains in that same toolbar under Client grouping. An applied Stage
  or Owner condition uses the existing joined Attio-style condition row below
  it, so grouped and flat views no longer diverge in control anatomy.
- The client repository removes the two explanatory bands, table heading,
  global expand control, and loaded-count footer from the visual canvas.
  Collapsed rows now retain only the initial, client name, create action, and
  right-edge disclosure. The project total and stage mix are removed.
- Expanded List sections preserve the existing project-card anatomy in
  responsive stage groups. This keeps the requested cards while avoiding the
  previous spreadsheet-like expanded rows. Board continues to use the
  governed stage-column component.
- Workspace pages with a title bar now expose one shared 49px header contract;
  Home remains the intentional prompt-led exception.

## Interaction and accessibility

- Signed-in browser verification confirmed direct developer utilities, the
  list-first state, immediate client disclosure, real project cards in the
  expanded Acuity Insights section, and the List → Board transition.
- A signed-in grouped-List pass applied `Stage equals Drafting`, showed the
  active-count badge and condition chip, and returned only Drafting cards when
  Acuity Insights was expanded.
- Grouping truth and the temporary backfill warning remain available through
  the repository region's screen-reader description without occupying visual
  space.
- Client expansion remains local, the six-live-subscription cap remains
  enforced, create links retain client prefill, and all 44px touch/keyboard
  contracts remain covered.
- After the Convex development functions were synchronized, the repeated
  interaction completed without a new page error. The browser log retains the
  earlier expected validator error from the pre-sync attempt.

## Product and data contract

- `users.isDeveloper` remains an additive exposure flag, not a role,
  capability, route grant, or workflow permission. Admin and server-side
  authorization remain authoritative.
- Client grouping remains a display grouping of recorded names. Stage and Owner
  now constrain the existing per-section query through server indexes; client
  headings remain the paginated recorded-name projection. No durable Client or
  Company entity, mutation, drag-to-transition behavior, or new subscription
  was introduced.
- Home creation gating, blank-intake flow, account-menu simplification, and the
  previously restored shader remain intact from the preceding pass.

## Verification

- Grouped-filter focused unit suite: 1 file / 20 tests passed.
- Grouped-filter focused browser component suite: 3 files / 32 tests passed;
  the final single-file regression rerun passed 12/12. Existing Svelte
  `derived_inert` test-environment warnings remain non-blocking.
- Svelte diagnostics after the query/index change: 0 errors and 0 warnings.
- Convex development deployment synchronized successfully and added
  `projects.by_client_owner_stage_rank_updated`.
- Signed-in in-app-browser filter pass: passed on `localhost:3001` with the
  Drafting condition and three filtered Acuity Insights cards visible.
- Latest client-row refinement: focused passes completed with 27 tests and 20
  tests respectively after the 44px chevron adjustment.
- Focused browser component suite: 7 files / 53 tests passed.
- Unit suite: 76 files / 668 tests passed.
- Full browser component suite: 46 files / 260 tests passed. Existing Svelte
  `derived_inert` test-environment warnings remain non-blocking.
- Svelte diagnostics: 0 errors and 0 warnings.
- Production build: passed. Existing buffer externalization and chunk-size
  notices remain non-blocking and unrelated to this change.
- Signed-in in-app-browser pass: passed on `localhost:3001`; List, expanded
  cards, Board switch, role-aware rail, and error-free console were verified.
- `git diff --check`: passed.

final result: passed
