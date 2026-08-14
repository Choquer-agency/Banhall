# Design QA — Attio-informed workspace and Home refinement

## Comparison target

- Authenticated Attio source, Banhall before/after, Paste-default, Attach-mode,
  full-view, and focused comparisons were inspected at 1405 × 1036 CSS px,
  deviceScaleFactor 1, desktop, light theme, authenticated Admin, Home selected,
  expanded rail.
- The generated captures were removed from `.codex` at the owner's request
  before this change was committed; this report retains the resulting findings.

## Findings

No actionable P0, P1, or P2 differences remain in the scoped rail or Home
refinement.

- Home chrome: the redundant full-width `Home` toolbar is removed. The greeting
  is now the single page-level heading, while the mobile drawer and hidden-rail
  restore controls remain available as unframed shell controls.
- Transcript source: Paste and Attach file are one mutually exclusive tablist.
  Paste is selected on entry and exposes the transcript textarea immediately;
  Attach exposes a dedicated `.docx` chooser panel and does not launch the
  operating-system picker until `Choose file` is pressed.
- State truth: switching modes preserves in-progress local text while the
  existing project-intent handoff receives only the active source. No project,
  workflow state, permission, or backend contract changed.
- Spacing and hierarchy: removing the 49px toolbar does not pull the opening
  composition upward; governed `pt-24` spacing keeps the greeting/composer
  cluster in its established position. The shader wash and 44.75rem content
  boundary remain intact.
- Visual system: the selector uses the existing chrome, surface, shadow, line,
  ink, and focus tokens. Clipboard, paperclip, document, and arrow affordances
  use the installed Phosphor family; no proprietary Attio asset or SVG path is
  copied.
- Responsive/accessibility: the selector exposes `tablist` / `tab` semantics
  and truthful `aria-selected` state. The mobile navigation control remains
  reachable at 390 × 844 without restoring the removed toolbar.

## Comparison history

- The initial Home capture showed a P2 redundant context bar above a page that
  already had a clear `Good morning` heading, plus two adjacent actions that
  could both appear independently actionable.
- The first implementation removed the bar, retained the shader, and changed
  the actions into an exclusive selector with Paste selected by default.
- The Attach-state capture verified the alternate panel and explicit file
  chooser. The final semantic follow-up promoted the greeting to `h1`; this is
  intentionally pixel-identical to the captured implementation.
- The earlier sidebar pass remains verified against the authenticated Attio
  source: measured rail geometry, left disclosure chevron, differentiated Admin
  icon colours, collapse/restore motion, command palette, and Banhall-specific
  routes/content are unchanged by this Home refinement.

## Browser and engineering verification

- Signed-in browser interaction: Paste → Attach → Paste is exclusive; Attach
  does not open the file picker automatically; the Paste textarea returns; no
  application console errors were observed.
- Target Home component suite: 2 files / 10 tests passed.
- Unit suite: 76 files / 667 tests passed.
- Browser component suite (serialized): 45 files / 255 tests passed. Existing
  Svelte `derived_inert` test-environment warnings remain non-blocking.
- Svelte diagnostics: 0 errors and 0 warnings.
- Production build: passed. Existing browser-buffer externalization notices
  remain non-blocking and unrelated to this change.
- `git diff --check`: passed.

final result: passed
